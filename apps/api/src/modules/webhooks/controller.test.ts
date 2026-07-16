import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract (status codes, envelopes, which args reach the service)
// without re-testing service behaviour covered in service.test.ts.
vi.mock("./service.js", () => ({
  webhookEndpointService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listDeliveries: vi.fn(),
    retryDelivery: vi.fn()
  }
}));

const { webhookEndpointController } = await import("./controller.js");
const { webhookEndpointService } = await import("./service.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

// Event names must come from outboundWebhookEventNameSchema's enum — these are
// outbound signed webhooks, not inbound ESP normalization.
const validCreateBody = {
  organizationId: "org_1",
  name: "Delivery feed",
  url: "https://example.com/hooks/qqueue",
  events: ["email.delivered", "email.bounced"],
  enabled: true
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("webhookEndpointController.list", () => {
  it("lists endpoints for the org and user pinned upstream", async () => {
    const rows = [{ id: "whe_1" }];
    vi.mocked(webhookEndpointService.list).mockResolvedValue(rows as never);
    const res = mockRes();

    await webhookEndpointController.list(
      { organizationId: "org_1", userId: "usr_1" } as Request,
      res
    );

    expect(webhookEndpointService.list).toHaveBeenCalledWith("org_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("webhookEndpointController.create", () => {
  it("creates an endpoint and responds 201 with the one-time signing secret", async () => {
    // create returns { endpoint, secret }; the plaintext secret is only ever
    // visible in this response, so the envelope must carry it through intact.
    const result = { endpoint: { id: "whe_1" }, secret: "whsec_abc" };
    vi.mocked(webhookEndpointService.create).mockResolvedValue(result as never);
    const res = mockRes();

    await webhookEndpointController.create(
      { body: validCreateBody, userId: "usr_1" } as Request,
      res
    );

    expect(webhookEndpointService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        events: ["email.delivered", "email.bounced"]
      }),
      "usr_1"
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: result });
  });

  it("rejects an unknown event name before reaching the service", async () => {
    await expect(
      webhookEndpointController.create(
        { body: { ...validCreateBody, events: ["email.exploded"] } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(webhookEndpointService.create).not.toHaveBeenCalled();
  });

  it("rejects a non-URL target before reaching the service", async () => {
    await expect(
      webhookEndpointController.create(
        { body: { ...validCreateBody, url: "not-a-url" } } as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(webhookEndpointService.create).not.toHaveBeenCalled();
  });
});

describe("webhookEndpointController.update", () => {
  it("passes the validated partial body through to the service", async () => {
    const updated = { id: "whe_1", enabled: false };
    vi.mocked(webhookEndpointService.update).mockResolvedValue(updated as never);
    const res = mockRes();

    await webhookEndpointController.update(
      {
        params: { id: "whe_1" },
        userId: "usr_1",
        body: { enabled: false }
      } as unknown as Request,
      res
    );

    expect(webhookEndpointService.update).toHaveBeenCalledWith("whe_1", "usr_1", {
      enabled: false
    });
    expect(res.json).toHaveBeenCalledWith({ data: updated });
  });

  it("rejects an empty update body — the schema requires at least one field", async () => {
    await expect(
      webhookEndpointController.update(
        { params: { id: "whe_1" }, userId: "usr_1", body: {} } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow();
    expect(webhookEndpointService.update).not.toHaveBeenCalled();
  });
});

describe("webhookEndpointController.delete", () => {
  it("deletes by id and responds 204 with no body", async () => {
    vi.mocked(webhookEndpointService.delete).mockResolvedValue(undefined as never);
    const res = mockRes();

    await webhookEndpointController.delete(
      { params: { id: "whe_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(webhookEndpointService.delete).toHaveBeenCalledWith("whe_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("webhookEndpointController.listDeliveries", () => {
  it("lists delivery history for the endpoint", async () => {
    const rows = [{ id: "whd_1" }];
    vi.mocked(webhookEndpointService.listDeliveries).mockResolvedValue(rows as never);
    const res = mockRes();

    await webhookEndpointController.listDeliveries(
      { params: { id: "whe_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(webhookEndpointService.listDeliveries).toHaveBeenCalledWith("whe_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: rows });
  });
});

describe("webhookEndpointController.retryDelivery", () => {
  it("retries by deliveryId — not the endpoint id param", async () => {
    const delivery = { id: "whd_1", status: "PENDING" };
    vi.mocked(webhookEndpointService.retryDelivery).mockResolvedValue(delivery as never);
    const res = mockRes();

    await webhookEndpointController.retryDelivery(
      {
        params: { id: "whe_1", deliveryId: "whd_1" },
        userId: "usr_1"
      } as unknown as Request,
      res
    );

    expect(webhookEndpointService.retryDelivery).toHaveBeenCalledWith("whd_1", "usr_1");
    expect(res.json).toHaveBeenCalledWith({ data: delivery });
  });

  it("surfaces the service's conflict on an already-delivered webhook", async () => {
    vi.mocked(webhookEndpointService.retryDelivery).mockRejectedValue(
      new Error("Delivered webhook deliveries cannot be retried")
    );

    await expect(
      webhookEndpointController.retryDelivery(
        { params: { deliveryId: "whd_1" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Delivered webhook deliveries cannot be retried");
  });
});
