import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const h = vi.hoisted(() => ({
  campaignQueue: { addBulk: vi.fn(), upsertJobScheduler: vi.fn() },
  emailQueue: { addBulk: vi.fn() },
  recurringQueue: { upsertJobScheduler: vi.fn() },
  webhookQueue: { addBulk: vi.fn() },
}));
vi.mock("../queues/campaign-processing.queue.js", () => ({
  campaignProcessingQueue: h.campaignQueue,
}));
vi.mock("../queues/email-sending.queue.js", () => ({
  emailSendingQueue: h.emailQueue,
}));
vi.mock("../queues/recurring-send.queue.js", () => ({
  recurringSendQueue: h.recurringQueue,
  recurringSendSchedulerId: (id: string) => `recurring-send-${id}`,
}));
vi.mock("../queues/webhook-delivery.queue.js", () => ({
  webhookDeliveryQueue: h.webhookQueue,
}));

const { recoverQueuedWork } = await import("./recovery.js");

function noWork() {
  prismaMock.campaign.findMany.mockResolvedValue([] as never);
  prismaMock.emailJob.findMany.mockResolvedValue([] as never);
  prismaMock.webhookDelivery.findMany.mockResolvedValue([] as never);
  prismaMock.recurringSend.findMany.mockResolvedValue([] as never);
}

beforeEach(() => {
  for (const queue of Object.values(h)) {
    for (const fn of Object.values(queue)) {
      fn.mockReset().mockResolvedValue(undefined);
    }
  }
  prismaMock.emailJob.updateMany.mockResolvedValue({ count: 0 } as never);
  noWork();
});

describe("recoverQueuedWork", () => {
  it("repairs a stale Outbox summary after SMTP acceptance was recorded", async () => {
    prismaMock.emailJob.findMany.mockImplementation(async (args: unknown) => {
      const where = (
        args as { where?: { groupPrimary?: boolean; sendGroupId?: unknown } }
      ).where;
      if (where?.groupPrimary)
        return [{ organizationId: "o1", sendGroupId: "g1" }] as never;
      if (where?.sendGroupId === "g1")
        return [{ status: "SENT" }, { status: "FAILED" }] as never;
      return [] as never;
    });
    await recoverQueuedWork();
    expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "o1", sendGroupId: "g1", groupPrimary: true },
      data: { groupStatus: "SENT" },
    });
    expect(h.emailQueue.addBulk).not.toHaveBeenCalled();
  });
  it("touches no queue when there is nothing to recover", async () => {
    await recoverQueuedWork();
    expect(h.emailQueue.addBulk).not.toHaveBeenCalled();
    expect(h.campaignQueue.addBulk).not.toHaveBeenCalled();
    expect(h.webhookQueue.addBulk).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "UNCERTAIN" } })
    );
  });

  it("re-enqueues QUEUED jobs, preserving a future scheduledAt as delay", async () => {
    const future = new Date(Date.now() + 60_000);
    prismaMock.emailJob.findMany.mockImplementation(async (args: unknown) =>
      (args as { where?: { status?: string } })?.where?.status === "QUEUED"
        ? ([{ id: "j1", scheduledAt: future }] as never)
        : ([] as never)
    );

    await recoverQueuedWork();

    const batch = h.emailQueue.addBulk.mock.calls[0][0];
    expect(batch).toHaveLength(1);
    expect(batch[0].opts.jobId).toBe("email-j1");
    expect(batch[0].opts.delay).toBeGreaterThan(0);
  });

  it("marks interrupted SMTP attempts uncertain without resending them", async () => {
    prismaMock.emailJob.updateMany.mockResolvedValue({ count: 2 } as never);
    await recoverQueuedWork();
    expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
      where: { status: "PROCESSING", updatedAt: { lt: expect.any(Date) } },
      data: { status: "UNCERTAIN" },
    });
    expect(h.emailQueue.addBulk).not.toHaveBeenCalled();
  });

  it("re-registers schedulers for recurring campaigns and sends", async () => {
    prismaMock.campaign.findMany.mockImplementation(async (args: unknown) =>
      (args as { where?: { cronExpression?: unknown } })?.where
        ?.cronExpression &&
      typeof (args as { where: { cronExpression: unknown } }).where
        .cronExpression === "object"
        ? ([
            { id: "c1", cronExpression: "0 9 * * 1", timezone: "UTC" },
          ] as never)
        : ([] as never)
    );
    prismaMock.recurringSend.findMany.mockResolvedValue([
      { id: "rs1", cronExpression: "0 8 * * *", timezone: "UTC" },
    ] as never);

    await recoverQueuedWork();

    expect(h.campaignQueue.upsertJobScheduler).toHaveBeenCalledWith(
      "campaign-recurring-c1",
      { pattern: "0 9 * * 1", tz: "UTC" },
      expect.anything()
    );
    expect(h.recurringQueue.upsertJobScheduler).toHaveBeenCalledWith(
      "recurring-send-rs1",
      { pattern: "0 8 * * *", tz: "UTC" },
      expect.anything()
    );
  });
});
