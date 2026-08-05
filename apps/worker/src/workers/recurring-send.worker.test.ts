import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const h = vi.hoisted(() => ({
  emailSendingQueue: { add: vi.fn(), addBulk: vi.fn() },
  renderHtmlAsEmailSafe: vi.fn()
}));

vi.mock("../queues/email-sending.queue.js", () => ({
  emailSendingQueue: h.emailSendingQueue
}));
vi.mock("@qqueue/email-engine", () => ({
  renderHtmlAsEmailSafe: h.renderHtmlAsEmailSafe
}));

const { processRecurringSend } = await import("./recurring-send.worker.js");

function makeSend(overrides: Record<string, unknown> = {}) {
  return {
    id: "rs-1",
    organizationId: "org-1",
    createdByUserId: "user-1",
    name: "Weekly digest",
    subject: "Digest for {{company}}",
    html: "<p>Hello</p>",
    text: null,
    to: ["a@example.com"],
    cc: [],
    bcc: [],
    contactIds: [],
    listIds: [],
    replyTo: null,
    smtpConnectionId: "smtp-1",
    templateId: null,
    variables: { company: "Acme" },
    cronExpression: "0 9 * * 1",
    timezone: "UTC",
    status: "ACTIVE",
    nextRunAt: null,
    lastRunAt: null,
    ...overrides
  };
}

const job = { id: "job-1", data: { recurringSendId: "rs-1" }, timestamp: 1000 };

beforeEach(() => {
  h.emailSendingQueue.add.mockReset();
  h.renderHtmlAsEmailSafe.mockReset();
  h.renderHtmlAsEmailSafe.mockResolvedValue({
    html: "<mjml-rendered/>",
    usedFallback: false,
    errors: []
  });
  prismaMock.recurringSendRun.findUnique.mockResolvedValue(null as never);
  prismaMock.recurringSendRun.create.mockResolvedValue({ id: "run-1" } as never);
  prismaMock.emailJob.create.mockResolvedValue({ id: "ej-1" } as never);
});

describe("processRecurringSend", () => {
  it("creates a bulk EmailJob with origin MANUAL and enqueues it", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(makeSend() as never);

    await processRecurringSend(job);

    expect(prismaMock.emailJob.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "org-1",
      smtpConnectionId: "smtp-1",
      toEmail: "a@example.com",
      origin: "MANUAL",
      // Recurring sends are bulk mail: the worker attaches List-Unsubscribe.
      isBulk: true,
      createdByUserId: "user-1",
      status: "QUEUED",
      // {{company}} substituted from the stored variables.
      subject: "Digest for Acme",
      html: "<mjml-rendered/>"
    });
    // A single-recipient occurrence needs no group.
    expect(data.sendGroupId).toBeNull();

    expect(h.emailSendingQueue.add).toHaveBeenCalledWith(
      "send-email",
      { emailJobId: "ej-1" },
      expect.objectContaining({ jobId: "email-ej-1", attempts: 3 })
    );
  });

  it("fans out one job per recipient, copies riding the first only", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(
      makeSend({ to: ["a@example.com", "b@example.com"], cc: ["cc@example.com"] }) as never
    );
    prismaMock.emailJob.create
      .mockResolvedValueOnce({ id: "ej-a" } as never)
      .mockResolvedValueOnce({ id: "ej-b" } as never);

    await processRecurringSend(job);

    expect(prismaMock.emailJob.create).toHaveBeenCalledTimes(2);
    const [first, second] = prismaMock.emailJob.create.mock.calls.map(
      (call) => call[0].data
    );
    expect(first.toEmail).toBe("a@example.com");
    expect(second.toEmail).toBe("b@example.com");
    // CC rides exactly one job — one copy per copy-recipient, not one per To.
    expect(first.cc).toEqual(["cc@example.com"]);
    expect(second.cc).toEqual([]);
    // Both are bulk and share a group.
    expect(first.isBulk).toBe(true);
    expect(second.isBulk).toBe(true);
    expect(first.sendGroupId).toEqual(expect.any(String));
    expect(second.sendGroupId).toBe(first.sendGroupId);
    // Every job is enqueued; the run records the first as primary.
    expect(h.emailSendingQueue.add).toHaveBeenCalledTimes(2);
    expect(prismaMock.recurringSendRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { emailJobId: "ej-a" }
    });
  });

  it("does nothing when the send is paused", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(
      makeSend({ status: "PAUSED" }) as never
    );

    await processRecurringSend(job);

    expect(prismaMock.recurringSendRun.create).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
  });

  it("does nothing when the send no longer exists", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(null as never);

    await processRecurringSend(job);

    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
  });

  it("is idempotent: a redelivered occurrence creates no second email", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(makeSend() as never);
    prismaMock.recurringSendRun.findUnique.mockResolvedValue({
      id: "run-existing"
    } as never);

    await processRecurringSend(job);

    expect(prismaMock.recurringSendRun.create).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    expect(h.emailSendingQueue.add).not.toHaveBeenCalled();
  });

  it("keys the occurrence on the BullMQ job id when none is supplied", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(makeSend() as never);

    await processRecurringSend(job);

    expect(prismaMock.recurringSendRun.findUnique).toHaveBeenCalledWith({
      where: {
        recurringSendId_occurrenceKey: {
          recurringSendId: "rs-1",
          occurrenceKey: "job-1"
        }
      },
      select: { id: true }
    });
  });

  it("records the occurrence but sends nothing when there are no recipients", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(
      makeSend({ to: [], contactIds: [], listIds: [] }) as never
    );

    await processRecurringSend(job);

    // The run is still recorded, or this firing would retry forever.
    expect(prismaMock.recurringSendRun.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    expect(prismaMock.recurringSend.update).toHaveBeenCalledTimes(1);
  });

  it("resolves list members fresh at each firing and dedupes against To", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(
      makeSend({ to: ["A@Example.com"], listIds: ["list-1"] }) as never
    );
    prismaMock.contactListMember.findMany.mockResolvedValue([
      { contactId: "c-1" },
      { contactId: "c-2" }
    ] as never);
    prismaMock.contact.findMany.mockResolvedValue([
      { email: "a@example.com" }, // same as the To entry, different casing
      { email: "b@example.com" }
    ] as never);

    await processRecurringSend(job);

    // Deduplicated case-insensitively, one job per remaining recipient.
    expect(prismaMock.emailJob.create).toHaveBeenCalledTimes(2);
    const recipients = prismaMock.emailJob.create.mock.calls.map(
      (call) => call[0].data.toEmail
    );
    expect(recipients).toEqual(["a@example.com", "b@example.com"]);
  });

  it("advances lastRunAt and nextRunAt after a firing", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(makeSend() as never);

    await processRecurringSend(job);

    const update = prismaMock.recurringSend.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "rs-1" });
    expect(update.data.lastRunAt).toBeInstanceOf(Date);
    expect(update.data.nextRunAt).toBeInstanceOf(Date);
  });
});
