import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";

const queueAdd = vi.fn();
vi.mock("../../queues/email-sending.queue.js", () => ({
  emailSendingQueue: { add: queueAdd }
}));

vi.mock("@qqueue/email-engine", () => ({
  injectTracking: vi.fn((html: string | undefined) => html)
}));

const providerSend = vi.fn();
vi.mock("../smtp-connections/service.js", () => ({
  smtpConnectionService: {
    getProviderForConnection: vi.fn(() => ({ send: providerSend }))
  }
}));

const storageGetObject = vi.fn();
vi.mock("../../lib/storage.js", () => ({
  storage: {
    getObject: storageGetObject,
    putObject: vi.fn(),
    deleteObject: vi.fn()
  }
}));

const { transactionalEmailService } = await import("./service.js");

const smtpConnection = {
  id: "smtp_1",
  organizationId: "org_1",
  fromEmail: "from@b.com",
  fromName: "Sender"
};

beforeEach(() => {
  queueAdd.mockReset().mockResolvedValue(undefined);
  providerSend.mockReset();
  // Default: no attachments. Individual tests override findMany to attach files.
  prismaMock.emailAttachment.findMany.mockResolvedValue([] as never);
  prismaMock.emailAttachment.updateMany.mockResolvedValue({ count: 0 } as never);
  storageGetObject.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("transactionalEmailService.send", () => {
  it("throws 404 when no smtp connection is found", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        subject: "Hi",
        html: "<p>Hi</p>"
      })
    ).rejects.toThrow("SMTP connection not found");
  });

  it("throws 404 when the referenced template is missing", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.template.findFirst.mockResolvedValue(null);
    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        templateId: "tpl_1"
      })
    ).rejects.toThrow("Template not found");
  });

  it("throws 400 when there is no subject or body", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    await expect(
      transactionalEmailService.send({ organizationId: "org_1", to: "x@y.com" })
    ).rejects.toThrow("Provide a subject and html/text body, or a templateId");
  });

  it("queues a future email and does not send inline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      text: "Body",
      scheduledAt: "2026-01-01T01:00:00.000Z"
    });

    expect(result).toEqual({ id: "job_1", status: "QUEUED" });
    expect(queueAdd).toHaveBeenCalledOnce();
    expect(providerSend).not.toHaveBeenCalled();
  });

  it("rejects scheduledAt values that are not in the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        subject: "Hi",
        text: "Body",
        scheduledAt: "2025-01-01T00:00:00.000Z"
      })
    ).rejects.toThrow("scheduledAt must be in the future");

    expect(providerSend).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("rejects invalid scheduledAt values", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        subject: "Hi",
        text: "Body",
        scheduledAt: "not-a-date"
      })
    ).rejects.toThrow("scheduledAt must be a valid ISO date");

    expect(providerSend).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("renders template variables and sends immediately, marking the job SENT", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.template.findFirst.mockResolvedValue({
      id: "tpl_1",
      subject: "Hi {{ name }}",
      html: "<p>Hello {{ name }}</p>",
      text: "Hello {{ missing }}"
    } as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.emailJob.update.mockResolvedValue({ id: "job_1", status: "SENT" } as never);
    providerSend.mockResolvedValue({
      messageId: "msg_1",
      provider: "smtp",
      accepted: ["x@y.com"],
      rejected: []
    });

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      templateId: "tpl_1",
      variables: { name: "World" }
    });

    expect(providerSend).toHaveBeenCalledOnce();
    const sendArgs = providerSend.mock.calls[0][0];
    expect(sendArgs.subject).toBe("Hi World");
    expect(sendArgs.from).toBe("Sender <from@b.com>");
    expect(result).toEqual({ id: "job_1", status: "SENT" });
    // last update marks SENT
    const lastUpdate = prismaMock.emailJob.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data.status).toBe("SENT");
  });

  it("uses just the fromEmail when there is no fromName", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({
      ...smtpConnection,
      fromName: null
    } as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.emailJob.update.mockResolvedValue({ id: "job_1" } as never);
    providerSend.mockResolvedValue({
      messageId: "m",
      provider: "smtp",
      accepted: [],
      rejected: []
    });

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });
    expect(providerSend.mock.calls[0][0].from).toBe("from@b.com");
  });

  it("persists cc, bcc and replyTo and forwards them to the provider", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.emailJob.update.mockResolvedValue({ id: "job_1", status: "SENT" } as never);
    providerSend.mockResolvedValue({
      messageId: "m",
      provider: "smtp",
      accepted: ["x@y.com"],
      rejected: []
    });

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      cc: ["cc@y.com"],
      bcc: ["bcc@y.com"],
      replyTo: "reply@y.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.cc).toEqual(["cc@y.com"]);
    expect(createData.bcc).toEqual(["bcc@y.com"]);
    expect(createData.replyTo).toBe("reply@y.com");

    const sendArgs = providerSend.mock.calls[0][0];
    expect(sendArgs.cc).toEqual(["cc@y.com"]);
    expect(sendArgs.bcc).toEqual(["bcc@y.com"]);
    expect(sendArgs.replyTo).toBe("reply@y.com");
  });

  it("defaults origin to TRANSACTIONAL and leaves createdByUserId unset", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.emailJob.update.mockResolvedValue({ id: "job_1", status: "SENT" } as never);
    providerSend.mockResolvedValue({
      messageId: "m",
      provider: "smtp",
      accepted: ["x@y.com"],
      rejected: []
    });

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.origin).toBe("TRANSACTIONAL");
    expect(createData.createdByUserId).toBeUndefined();
    expect(createData.cc).toEqual([]);
    expect(createData.bcc).toEqual([]);
  });

  it("sets origin MANUAL and createdByUserId on the manual path", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.emailJob.update.mockResolvedValue({ id: "job_1", status: "SENT" } as never);
    providerSend.mockResolvedValue({
      messageId: "m",
      provider: "smtp",
      accepted: ["x@y.com"],
      rejected: []
    });

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      origin: "MANUAL",
      createdByUserId: "user_1"
    });

    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.origin).toBe("MANUAL");
    expect(createData.createdByUserId).toBe("user_1");
  });

  it("links attachments to the job and forwards their blobs to the provider (inline)", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.emailJob.update.mockResolvedValue({ id: "job_1", status: "SENT" } as never);
    prismaMock.emailAttachment.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.emailAttachment.findMany.mockResolvedValue([
      {
        id: "att_1",
        filename: "report.pdf",
        contentType: "application/pdf",
        storageKey: "org/org_1/k-report.pdf"
      }
    ] as never);
    storageGetObject.mockResolvedValue(Buffer.from("PDF"));
    providerSend.mockResolvedValue({
      messageId: "m",
      provider: "smtp",
      accepted: ["x@y.com"],
      rejected: []
    });

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      attachmentIds: ["att_1"]
    });

    // Links only unlinked rows in this org to the new job.
    expect(prismaMock.emailAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["att_1"] }, organizationId: "org_1", emailJobId: null },
      data: { emailJobId: "job_1" }
    });

    const sendArgs = providerSend.mock.calls[0][0];
    expect(sendArgs.attachments).toEqual([
      {
        filename: "report.pdf",
        content: Buffer.from("PDF"),
        contentType: "application/pdf"
      }
    ]);
  });

  it("links attachments on the scheduled (send-later) path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);
    prismaMock.emailAttachment.updateMany.mockResolvedValue({ count: 1 } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      text: "Body",
      scheduledAt: "2026-01-01T01:00:00.000Z",
      attachmentIds: ["att_1"]
    });

    expect(prismaMock.emailAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["att_1"] }, organizationId: "org_1", emailJobId: null },
      data: { emailJobId: "job_1" }
    });
    // Blobs are not loaded inline for a scheduled send — the worker does that.
    expect(storageGetObject).not.toHaveBeenCalled();
  });

  it("persists cc, bcc, replyTo and origin on the scheduled (send-later) path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      cc: ["cc@y.com"],
      bcc: ["bcc@y.com"],
      replyTo: "reply@y.com",
      subject: "Hi",
      text: "Body",
      scheduledAt: "2026-01-01T01:00:00.000Z"
    });

    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.cc).toEqual(["cc@y.com"]);
    expect(createData.bcc).toEqual(["bcc@y.com"]);
    expect(createData.replyTo).toBe("reply@y.com");
    expect(createData.origin).toBe("TRANSACTIONAL");
    expect(providerSend).not.toHaveBeenCalled();
  });

  it("marks the job FAILED and throws 502 when the provider send fails", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.emailJob.update.mockResolvedValue({ id: "job_1" } as never);
    providerSend.mockRejectedValue(new Error("smtp down"));

    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        subject: "Hi",
        html: "<p>Hi</p>"
      })
    ).rejects.toThrow(HttpError);

    const failUpdate = prismaMock.emailJob.update.mock.calls.at(-1)?.[0];
    expect(failUpdate?.data.status).toBe("FAILED");
  });
});
