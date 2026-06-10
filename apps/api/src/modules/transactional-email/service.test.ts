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
    prismaMock.emailJob.create.mockResolvedValue({ id: "job_1" } as never);

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      text: "Body",
      scheduledAt: "2026-01-01T01:00:00.000Z"
    });

    expect(result.providerResult).toBeNull();
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
    expect(result.providerResult).toMatchObject({ messageId: "msg_1" });
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
