import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const h = vi.hoisted(() => {
  let capturedProcessor:
    | ((job: { data: { deliveryId: string } }) => Promise<unknown>)
    | undefined;

  return {
    decryptSecret: vi.fn(() => "plain-secret"),
    getProcessor: () => capturedProcessor,
    setProcessor: (p: typeof capturedProcessor) => {
      capturedProcessor = p;
    }
  };
});

vi.mock("bullmq", () => ({
  Worker: vi.fn((_name: string, processor: never) => {
    h.setProcessor(processor);
    return { name: _name };
  })
}));

vi.mock("../config/redis.js", () => ({ redisConnection: {} }));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: h.decryptSecret
}));

import { startWebhookDeliveryWorker } from "./webhook-delivery.worker.js";

const fetchMock = vi.fn();

const baseDelivery = {
  id: "del_1",
  status: "PENDING",
  eventName: "email.delivered",
  payload: { id: "evt_1", type: "email.delivered" },
  endpoint: {
    enabled: true,
    deletedAt: null,
    secretEncrypted: "encrypted-secret",
    url: "https://example.com/webhook"
  }
};

function run(deliveryId = "del_1") {
  startWebhookDeliveryWorker();
  const processor = h.getProcessor();
  if (!processor) {
    throw new Error("processor not captured");
  }
  return processor({ data: { deliveryId } });
}

describe("webhook delivery worker", () => {
  beforeEach(() => {
    h.decryptSecret.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("starts a Worker for the webhook delivery queue", () => {
    const worker = startWebhookDeliveryWorker();
    expect(worker).toMatchObject({ name: "webhook-delivery" });
  });

  it("returns when the delivery is missing", async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue(null as never);

    await run();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it("returns when the delivery is already delivered", async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({
      ...baseDelivery,
      status: "DELIVERED"
    } as never);

    await run();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it("cancels delivery when the endpoint is disabled", async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({
      ...baseDelivery,
      endpoint: { ...baseDelivery.endpoint, enabled: false }
    } as never);

    await run();

    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        status: "CANCELLED",
        attempts: { increment: 1 },
        error: "Webhook endpoint is disabled"
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the webhook and marks it delivered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    prismaMock.webhookDelivery.findUnique.mockResolvedValue(
      baseDelivery as never
    );
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    await run();

    expect(h.decryptSecret).toHaveBeenCalledWith("encrypted-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "QQueue-Webhooks/1.0",
          "QQueue-Event": "email.delivered",
          "QQueue-Delivery": "del_1",
          "QQueue-Timestamp": "1767225600",
          "QQueue-Signature": expect.stringMatching(/^v1=/)
        }),
        body: JSON.stringify(baseDelivery.payload)
      })
    );
    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        status: "DELIVERED",
        attempts: { increment: 1 },
        responseStatus: 204,
        error: null,
        nextAttemptAt: null,
        deliveredAt: new Date()
      }
    });
    vi.useRealTimers();
  });

  it("records failed response status and rethrows", async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue(
      baseDelivery as never
    );
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(run()).rejects.toThrow("Webhook endpoint returned 500");

    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: expect.objectContaining({
        status: "FAILED",
        attempts: { increment: 1 },
        responseStatus: 500,
        error: "Webhook endpoint returned 500",
        nextAttemptAt: expect.any(Date)
      })
    });
  });

  it("records network errors and rethrows", async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue(
      baseDelivery as never
    );
    fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(run()).rejects.toThrow("connection refused");

    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: expect.objectContaining({
        status: "FAILED",
        attempts: { increment: 1 },
        error: "connection refused",
        nextAttemptAt: expect.any(Date)
      })
    });
  });

  it("uses a generic message for non-Error failures", async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue(
      baseDelivery as never
    );
    fetchMock.mockRejectedValue("boom");

    await expect(run()).rejects.toBe("boom");

    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "Unknown webhook delivery error"
      })
    });
  });
});
