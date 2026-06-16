import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

// Capture the processor callback passed to `new Worker(name, processor, opts)`.
const h = vi.hoisted(() => {
  let capturedProcessor:
    | ((job: {
        id?: string;
        timestamp?: number;
        data: { campaignId: string; occurrenceKey?: string };
      }) => Promise<unknown>)
    | undefined;
  return {
    getProcessor: () => capturedProcessor,
    setProcessor: (p: typeof capturedProcessor) => {
      capturedProcessor = p;
    },
    emailSendingQueue: { addBulk: vi.fn() },
    campaignProcessingQueue: { add: vi.fn() },
    settleRunIfComplete: vi.fn()
  };
});

const { emailSendingQueue, campaignProcessingQueue, settleRunIfComplete } = h;

vi.mock("bullmq", () => ({
  Worker: vi.fn((_name: string, processor: never) => {
    h.setProcessor(processor);
    return { name: _name };
  })
}));

vi.mock("../config/redis.js", () => ({ redisConnection: {} }));

vi.mock("../queues/email-sending.queue.js", () => ({
  emailSendingQueue: h.emailSendingQueue
}));
vi.mock("../queues/campaign-processing.queue.js", () => ({
  campaignProcessingQueue: h.campaignProcessingQueue
}));

vi.mock("../lib/campaign-run.js", () => ({
  settleRunIfComplete: h.settleRunIfComplete
}));

import { startCampaignProcessingWorker } from "./campaign-processing.worker.js";

function run(job: {
  id?: string;
  timestamp?: number;
  data: { campaignId: string; occurrenceKey?: string };
}) {
  startCampaignProcessingWorker();
  const processor = h.getProcessor();
  if (!processor) {
    throw new Error("processor not captured");
  }
  return processor(job);
}

const baseTemplate = {
  subject: "Hi {{ firstName }}",
  html: "<p>Hello {{ firstName }} {{ lastName }} {{ missing }}</p>",
  text: "Hello {{ firstName }}"
};

beforeEach(() => {
  emailSendingQueue.addBulk.mockReset().mockResolvedValue(undefined);
  campaignProcessingQueue.add.mockReset().mockResolvedValue(undefined);
  settleRunIfComplete.mockReset().mockResolvedValue(undefined);
  // Default: nothing suppressed. Tests override to exclude specific addresses.
  prismaMock.suppression.findMany.mockResolvedValue([] as never);
});

describe("campaign-processing worker", () => {
  it("starts a Worker for the campaign-processing queue", () => {
    const worker = startCampaignProcessingWorker();
    expect(worker).toMatchObject({ name: "campaign-processing" });
  });

  it("does nothing when the campaign is missing", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue(null as never);
    await run({ id: "j1", data: { campaignId: "c1" } });
    expect(prismaMock.campaignRun.upsert).not.toHaveBeenCalled();
  });

  it.each(["CANCELLED", "PAUSED"])(
    "does nothing for a %s campaign",
    async (status) => {
      prismaMock.campaign.findUnique.mockResolvedValue({
        id: "c1",
        status
      } as never);
      await run({ id: "j1", data: { campaignId: "c1" } });
      expect(prismaMock.campaignRun.upsert).not.toHaveBeenCalled();
    }
  );

  it("re-delays a one-shot SCHEDULED campaign whose time has not arrived", async () => {
    const future = new Date(Date.now() + 60_000);
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SCHEDULED",
      cronExpression: null,
      scheduledAt: future
    } as never);

    await run({ id: "j1", data: { campaignId: "c1", occurrenceKey: "occ" } });

    expect(campaignProcessingQueue.add).toHaveBeenCalledWith(
      "process-campaign",
      { campaignId: "c1", occurrenceKey: "occ" },
      expect.objectContaining({
        jobId: `campaign-c1-${future.toISOString()}`
      })
    );
    expect(prismaMock.campaignRun.upsert).not.toHaveBeenCalled();
  });

  it("returns early for a non-SENDING, non-SCHEDULED status (e.g. SENT)", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENT",
      cronExpression: null,
      scheduledAt: null
    } as never);
    await run({ id: "j1", data: { campaignId: "c1" } });
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
    expect(prismaMock.campaignRun.upsert).not.toHaveBeenCalled();
  });

  it("re-enqueues existing jobs on retry without recreating them", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: { members: [] }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([
      { id: "ej1", status: "QUEUED" },
      { id: "ej2", status: "QUEUED" }
    ] as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    expect(emailSendingQueue.addBulk).toHaveBeenCalledOnce();
    const arg = emailSendingQueue.addBulk.mock.calls[0][0];
    expect(arg).toHaveLength(2);
    expect(arg[0]).toMatchObject({
      name: "send-email",
      data: { emailJobId: "ej1" },
      opts: expect.objectContaining({ jobId: "email-ej1", attempts: 3 })
    });
  });

  it("transitions a SCHEDULED campaign to SENDING before processing", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SCHEDULED",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: { members: [] }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "SENDING" }
    });
  });

  it("cancels the campaign and throws when template or list missing", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: null,
      contactList: null,
      segment: null
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);

    await expect(run({ id: "j1", data: { campaignId: "c1" } })).rejects.toThrow(
      "Campaign requires a template and a contact list or segment"
    );
    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "CANCELLED" }
    });
  });

  it("throws when no default SMTP connection exists", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: { members: [{ contact: { email: "a@b.com" } }] }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null as never);

    await expect(run({ id: "j1", data: { campaignId: "c1" } })).rejects.toThrow(
      "Default SMTP connection not found"
    );
  });

  it("settles the run when there are no contacts", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: { members: [] }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
    expect(emailSendingQueue.addBulk).not.toHaveBeenCalled();
  });

  it("creates email jobs with rendered variables and enqueues them", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: {
        members: [
          { contact: { email: "a@b.com", firstName: "Ann", lastName: "Bee" } },
          { contact: { email: "c@d.com", firstName: null, lastName: null } }
        ]
      }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    // First findMany: existing jobs (none). Second (inside txn): created jobs.
    prismaMock.emailJob.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "new1" }, { id: "new2" }] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);
    prismaMock.emailJob.createMany.mockResolvedValue({ count: 2 } as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    expect(prismaMock.emailJob.createMany).toHaveBeenCalledOnce();
    const createData = prismaMock.emailJob.createMany.mock.calls[0][0].data;
    expect(createData[0]).toMatchObject({
      toEmail: "a@b.com",
      subject: "Hi Ann",
      html: "<p>Hello Ann Bee </p>",
      text: "Hello Ann",
      status: "QUEUED",
      origin: "CAMPAIGN"
    });
    // null first/last names render as empty strings.
    expect(createData[1]).toMatchObject({
      toEmail: "c@d.com",
      subject: "Hi ",
      html: "<p>Hello   </p>"
    });
    expect(emailSendingQueue.addBulk).toHaveBeenCalledOnce();
    expect(emailSendingQueue.addBulk.mock.calls[0][0]).toHaveLength(2);
  });

  it("resolves a segment's contacts at send time when the campaign targets a segment", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: null,
      segment: {
        id: "seg1",
        rules: { field: "tags", match: "ANY", values: ["vip"] }
      }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "new1" }] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);
    // The segment path queries contacts directly rather than reading members.
    prismaMock.contact.findMany.mockResolvedValue([
      { email: "vip@b.com", firstName: "Vi", lastName: "Pea" }
    ] as never);
    prismaMock.emailJob.createMany.mockResolvedValue({ count: 1 } as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    // Resolves ACTIVE contacts matching the compiled rule tree, org-scoped.
    expect(prismaMock.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org1",
          status: "ACTIVE",
          tags: { hasSome: ["vip"] }
        })
      })
    );
    const createData = prismaMock.emailJob.createMany.mock.calls[0][0].data;
    expect(createData[0]).toMatchObject({ toEmail: "vip@b.com" });
    expect(emailSendingQueue.addBulk).toHaveBeenCalledOnce();
  });

  it("excludes suppressed addresses from fan-out", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: {
        members: [
          { contact: { email: "keep@b.com", firstName: "Ann", lastName: "Bee" } },
          { contact: { email: "blocked@b.com", firstName: "X", lastName: "Y" } }
        ]
      }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "new1" }] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);
    prismaMock.emailJob.createMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.suppression.findMany.mockResolvedValue([
      { email: "blocked@b.com" }
    ] as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    const createData = prismaMock.emailJob.createMany.mock.calls[0][0].data;
    expect(createData).toHaveLength(1);
    expect(createData[0]).toMatchObject({ toEmail: "keep@b.com" });
  });

  it("settles the run when every recipient is suppressed", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: {
        members: [{ contact: { email: "blocked@b.com" } }]
      }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);
    prismaMock.suppression.findMany.mockResolvedValue([
      { email: "blocked@b.com" }
    ] as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
    expect(prismaMock.emailJob.createMany).not.toHaveBeenCalled();
    expect(emailSendingQueue.addBulk).not.toHaveBeenCalled();
  });

  it("falls back to job id then timestamp for the occurrence key", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: { members: [] }
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([] as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);

    // No occurrenceKey, no id -> falls back to String(timestamp).
    await run({ timestamp: 1700, data: { campaignId: "c1" } });

    expect(prismaMock.campaignRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId_occurrenceKey: { campaignId: "c1", occurrenceKey: "1700" }
        }
      })
    );
  });

  it("A/B: sends the test fraction across variants, holds the remainder, schedules the decision", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: {
        members: [
          { contact: { email: "a@b.com", firstName: "A", lastName: "" } },
          { contact: { email: "c@d.com", firstName: "C", lastName: "" } },
          { contact: { email: "e@f.com", firstName: "E", lastName: "" } },
          { contact: { email: "g@h.com", firstName: "G", lastName: "" } }
        ]
      },
      abTestEnabled: true,
      abTestPercent: 50,
      abWinnerMetric: "OPEN",
      abTestWindowMin: 60,
      abTestStatus: null,
      variants: [
        { id: "v1", label: "A", subject: "Subject A" },
        { id: "v2", label: "B", subject: "Subject B" }
      ]
    } as never);
    prismaMock.campaignRun.upsert.mockResolvedValue({ id: "run1" } as never);
    prismaMock.emailJob.findMany
      .mockResolvedValueOnce([] as never) // existing jobs
      .mockResolvedValueOnce([{ id: "t1" }, { id: "t2" }] as never); // QUEUED test
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "smtp1" } as never);
    prismaMock.emailJob.createMany.mockResolvedValue({ count: 4 } as never);

    await run({ id: "j1", data: { campaignId: "c1" } });

    const createData = prismaMock.emailJob.createMany.mock.calls[0][0].data;
    // 50% of 4 = 2 test jobs (one per variant), 2 held PENDING jobs.
    const queued = createData.filter((d: { status: string }) => d.status === "QUEUED");
    const held = createData.filter((d: { status: string }) => d.status === "PENDING");
    expect(queued).toHaveLength(2);
    expect(held).toHaveLength(2);
    expect(queued[0]).toMatchObject({ variantId: "v1", subject: "Subject A" });
    expect(queued[1]).toMatchObject({ variantId: "v2", subject: "Subject B" });
    expect(held[0]).toMatchObject({ variantId: null });
    // Decision job scheduled with the window delay and a stable id.
    expect(campaignProcessingQueue.add).toHaveBeenCalledWith(
      "decide-ab-test",
      { campaignId: "c1", occurrenceKey: "j1", phase: "decide" },
      expect.objectContaining({
        delay: 60 * 60_000,
        jobId: "campaign-c1-j1-decide"
      })
    );
    // Only the test jobs are enqueued now.
    expect(emailSendingQueue.addBulk.mock.calls[0][0]).toHaveLength(2);
  });

  it("A/B decision: picks the winner by metric and releases the held remainder", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: { members: [] },
      abTestEnabled: true,
      abTestStatus: "TESTING",
      abWinnerMetric: "OPEN",
      variants: [
        { id: "v1", label: "A", subject: "Subject A" },
        { id: "v2", label: "B", subject: "Subject B" }
      ]
    } as never);
    prismaMock.campaignRun.findUnique.mockResolvedValue({ id: "run1" } as never);
    // Variant A wins on opens (5 vs 2).
    prismaMock.emailEvent.count
      .mockResolvedValueOnce(5 as never)
      .mockResolvedValueOnce(2 as never);
    prismaMock.emailJob.findMany.mockResolvedValue([
      { id: "h1", variables: { firstName: "Zoe" } }
    ] as never);

    await run({ id: "decide1", data: { campaignId: "c1", occurrenceKey: "j1", phase: "decide" } });

    expect(prismaMock.campaignVariant.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { isWinner: true }
    });
    // The held job is released with the winning subject and variant.
    expect(prismaMock.emailJob.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: { status: "QUEUED", variantId: "v1", subject: "Subject A" }
    });
    expect(emailSendingQueue.addBulk.mock.calls[0][0]).toHaveLength(1);
    // Marks DECIDED then SENT.
    const statuses = prismaMock.campaign.update.mock.calls.map(
      (c) => (c[0] as { data: { abTestStatus?: string } }).data.abTestStatus
    );
    expect(statuses).toContain("SENT");
  });

  it("A/B decision: is a no-op when already decided (not TESTING)", async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      id: "c1",
      status: "SENDING",
      cronExpression: null,
      scheduledAt: null,
      organizationId: "org1",
      templateId: "t1",
      template: baseTemplate,
      contactList: { members: [] },
      abTestEnabled: true,
      abTestStatus: "SENT",
      abWinnerMetric: "OPEN",
      variants: [
        { id: "v1", label: "A", subject: "A" },
        { id: "v2", label: "B", subject: "B" }
      ]
    } as never);

    await run({ id: "decide1", data: { campaignId: "c1", occurrenceKey: "j1", phase: "decide" } });

    expect(prismaMock.campaignVariant.update).not.toHaveBeenCalled();
    expect(emailSendingQueue.addBulk).not.toHaveBeenCalled();
  });
});
