import { beforeEach, describe, expect, it, vi } from "vitest";

const queues = vi.hoisted(() => ({
  emailSendingQueue: {
    name: "email-sending",
    getJobCounts: vi.fn(),
    getJobs: vi.fn(),
    getJob: vi.fn()
  },
  campaignProcessingQueue: {
    name: "campaign-processing",
    getJobCounts: vi.fn(),
    getJobs: vi.fn(),
    getJob: vi.fn()
  },
  webhookDeliveryQueue: {
    name: "webhook-delivery",
    getJobCounts: vi.fn(),
    getJobs: vi.fn(),
    getJob: vi.fn()
  }
}));

vi.mock("../../queues/email-sending.queue.js", () => ({
  emailSendingQueue: queues.emailSendingQueue
}));
vi.mock("../../queues/campaign-processing.queue.js", () => ({
  campaignProcessingQueue: queues.campaignProcessingQueue
}));
vi.mock("../../queues/webhook-delivery.queue.js", () => ({
  webhookDeliveryQueue: queues.webhookDeliveryQueue
}));

const { queueOperationsService } = await import("./service.js");

function job(id: string, state = "failed") {
  return {
    id,
    name: "send-email",
    queueName: "email-sending",
    data: { emailJobId: "email_1" },
    attemptsMade: 1,
    opts: { attempts: 3 },
    timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
    processedOn: undefined,
    finishedOn: undefined,
    failedReason: "SMTP failed",
    getState: vi.fn().mockResolvedValue(state),
    retry: vi.fn().mockResolvedValue(undefined)
  };
}

describe("queueOperationsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const queue of Object.values(queues)) {
      queue.getJobCounts.mockResolvedValue({
        waiting: 1,
        delayed: 1,
        active: 1,
        failed: 1,
        completed: 2
      });
      queue.getJobs
        .mockResolvedValueOnce([job("queued")])
        .mockResolvedValueOnce([job("active")])
        .mockResolvedValueOnce([job("failed")]);
    }
  });

  it("returns counts and recent jobs for each queue", async () => {
    const result = await queueOperationsService.summary();

    expect(result).toHaveLength(3);
    expect(result[0].counts).toEqual({
      queued: 2,
      processing: 1,
      failed: 1,
      completed: 2
    });
    expect(result[0].failedJobs[0]).toMatchObject({
      id: "failed",
      queueName: "email-sending",
      failedReason: "SMTP failed"
    });
  });

  it("retries failed jobs", async () => {
    const failedJob = job("failed");
    queues.emailSendingQueue.getJob.mockResolvedValue(failedJob);

    await queueOperationsService.retry("email-sending", "failed");

    expect(failedJob.retry).toHaveBeenCalledWith("failed");
  });

  it("rejects retrying non-failed jobs", async () => {
    queues.emailSendingQueue.getJob.mockResolvedValue(job("active", "active"));

    await expect(
      queueOperationsService.retry("email-sending", "active")
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
