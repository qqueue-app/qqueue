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
  noWork();
});

describe("recoverQueuedWork", () => {
  it("touches no queue when there is nothing to recover", async () => {
    await recoverQueuedWork();
    expect(h.emailQueue.addBulk).not.toHaveBeenCalled();
    expect(h.campaignQueue.addBulk).not.toHaveBeenCalled();
    expect(h.webhookQueue.addBulk).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.updateMany).not.toHaveBeenCalled();
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

  // Phase 5: PROCESSING rows a crashed worker never finished used to stay
  // stranded forever — startup recovery only looked at QUEUED.
  it("re-queues jobs stranded in PROCESSING past the grace period", async () => {
    prismaMock.emailJob.findMany.mockImplementation(async (args: unknown) =>
      (args as { where?: { status?: string } })?.where?.status === "PROCESSING"
        ? ([{ id: "stuck1" }, { id: "stuck2" }] as never)
        : ([] as never)
    );
    prismaMock.emailJob.updateMany.mockResolvedValue({ count: 2 } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await recoverQueuedWork();

    // The grace period is part of the query, not post-filtering.
    const stuckQuery = prismaMock.emailJob.findMany.mock.calls.find(
      (call) =>
        (call[0] as { where?: { status?: string } })?.where?.status ===
        "PROCESSING"
    )?.[0] as { where: { updatedAt: { lt: Date } } };
    expect(stuckQuery.where.updatedAt.lt).toBeInstanceOf(Date);

    expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["stuck1", "stuck2"] } },
      data: { status: "QUEUED" },
    });
    const batch = h.emailQueue.addBulk.mock.calls[0][0];
    expect(
      batch.map((job: { opts: { jobId: string } }) => job.opts.jobId)
    ).toEqual(["email-stuck1", "email-stuck2"]);
    warn.mockRestore();
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
