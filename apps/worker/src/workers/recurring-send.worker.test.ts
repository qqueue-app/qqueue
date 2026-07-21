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
  it("creates an EmailJob with origin MANUAL and enqueues it", async () => {
    prismaMock.recurringSend.findUnique.mockResolvedValue(makeSend() as never);

    await processRecurringSend(job);

    expect(prismaMock.emailJob.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "org-1",
      smtpConnectionId: "smtp-1",
      toEmail: "a@example.com",
      origin: "MANUAL",
      createdByUserId: "user-1",
      status: "QUEUED",
      // {{company}} substituted from the stored variables.
      subject: "Digest for Acme",
      html: "<mjml-rendered/>"
    });

    expect(h.emailSendingQueue.add).toHaveBeenCalledWith(
      "send-email",
      { emailJobId: "ej-1" },
      expect.objectContaining({ jobId: "email-ej-1", attempts: 3 })
    );
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

    const data = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(data.toEmail).toBe("a@example.com, b@example.com");
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
