import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";

const webhookDeliveryQueue = vi.hoisted(() => ({
  add: vi.fn()
}));

vi.mock("../../queues/webhook-delivery.queue.js", () => ({
  webhookDeliveryQueue
}));

import { webhookEndpointService } from "./service.js";

beforeEach(() => {
  webhookDeliveryQueue.add.mockClear();
  vi.useRealTimers();
});

describe("webhookEndpointService.retryDelivery", () => {
  it("requeues a failed delivery for an owned endpoint", async () => {
    const retryDate = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(retryDate);

    prismaMock.webhookDelivery.findUnique.mockResolvedValue({
      id: "del_1",
      endpointId: "wh_1",
      status: "FAILED"
    } as never);
    prismaMock.webhookEndpoint.findFirst.mockResolvedValue({
      id: "wh_1",
      organizationId: "org_1"
    } as never);
    prismaMock.webhookDelivery.update.mockResolvedValue({
      id: "del_1",
      organizationId: "org_1",
      endpointId: "wh_1",
      emailEventId: "evt_1",
      eventName: "email.sent",
      status: "PENDING",
      attempts: 2,
      responseStatus: null,
      error: null,
      nextAttemptAt: retryDate,
      deliveredAt: null,
      createdAt: retryDate
    } as never);

    await expect(
      webhookEndpointService.retryDelivery("del_1", "user_1")
    ).resolves.toMatchObject({ id: "del_1", status: "PENDING" });

    expect(prismaMock.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        status: "PENDING",
        responseStatus: null,
        error: null,
        nextAttemptAt: retryDate
      },
      select: expect.any(Object)
    });
    expect(webhookDeliveryQueue.add).toHaveBeenCalledWith(
      "deliver-webhook",
      { deliveryId: "del_1" },
      expect.objectContaining({ attempts: 5 })
    );

    vi.useRealTimers();
  });

  it("rejects delivered deliveries", async () => {
    prismaMock.webhookDelivery.findUnique.mockResolvedValue({
      id: "del_1",
      endpointId: "wh_1",
      status: "DELIVERED"
    } as never);
    prismaMock.webhookEndpoint.findFirst.mockResolvedValue({
      id: "wh_1",
      organizationId: "org_1"
    } as never);

    await expect(
      webhookEndpointService.retryDelivery("del_1", "user_1")
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "conflict"
    } satisfies Partial<HttpError>);
  });
});
