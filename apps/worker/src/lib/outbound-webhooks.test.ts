import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const h = vi.hoisted(() => ({
  add: vi.fn()
}));

vi.mock("../queues/webhook-delivery.queue.js", () => ({
  webhookDeliveryQueue: { add: h.add }
}));

import { enqueueLatestWebhookDeliveries } from "./outbound-webhooks.js";

const emailEvent = {
  id: "evt_1",
  organizationId: "org_1",
  type: "DELIVERED",
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
  metadata: { provider: "smtp" },
  emailJob: {
    id: "job_1",
    toEmail: "to@example.com",
    subject: "Welcome",
    status: "SENT",
    messageId: "msg_1",
    campaignId: "camp_1",
    templateId: "tpl_1"
  }
};

describe("enqueueLatestWebhookDeliveries", () => {
  beforeEach(() => {
    h.add.mockReset();
  });

  it("returns when there is no matching email event", async () => {
    prismaMock.emailEvent.findFirst.mockResolvedValue(null as never);

    await enqueueLatestWebhookDeliveries({
      organizationId: "org_1",
      emailJobId: "job_1",
      type: "DELIVERED"
    });

    expect(prismaMock.webhookEndpoint.findMany).not.toHaveBeenCalled();
    expect(h.add).not.toHaveBeenCalled();
  });

  it("creates and queues one delivery for each matching endpoint", async () => {
    prismaMock.emailEvent.findFirst.mockResolvedValue(emailEvent as never);
    prismaMock.webhookEndpoint.findMany.mockResolvedValue([
      { id: "wh_1" },
      { id: "wh_2" }
    ] as never);
    prismaMock.webhookDelivery.create
      .mockResolvedValueOnce({ id: "del_1" } as never)
      .mockResolvedValueOnce({ id: "del_2" } as never);

    await enqueueLatestWebhookDeliveries({
      organizationId: "org_1",
      emailJobId: "job_1",
      type: "DELIVERED"
    });

    expect(prismaMock.emailEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org_1",
          emailJobId: "job_1",
          type: "DELIVERED"
        },
        orderBy: { occurredAt: "desc" }
      })
    );
    expect(prismaMock.webhookEndpoint.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        enabled: true,
        deletedAt: null,
        events: { has: "email.delivered" }
      },
      select: { id: true }
    });
    expect(prismaMock.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endpointId: "wh_1",
          emailEventId: "evt_1",
          eventName: "email.delivered",
          payload: expect.objectContaining({
            type: "email.delivered",
            createdAt: "2026-01-01T00:00:00.000Z"
          })
        })
      })
    );
    expect(h.add).toHaveBeenNthCalledWith(
      1,
      "deliver-webhook",
      { deliveryId: "del_1" },
      {
        jobId: "webhook-del_1",
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 }
      }
    );
    expect(h.add).toHaveBeenNthCalledWith(
      2,
      "deliver-webhook",
      { deliveryId: "del_2" },
      {
        jobId: "webhook-del_2",
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 }
      }
    );
  });
});
