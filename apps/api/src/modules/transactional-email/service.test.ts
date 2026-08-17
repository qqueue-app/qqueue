import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const queueAdd = vi.fn();
vi.mock("../../queues/email-sending.queue.js", () => ({
  emailSendingQueue: { add: queueAdd }
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
  // Default: no attachments. Individual tests override findMany to attach files.
  prismaMock.emailAttachment.findMany.mockResolvedValue([] as never);
  prismaMock.emailAttachment.updateMany.mockResolvedValue({ count: 0 } as never);
  storageGetObject.mockReset();
  // Send-as enforcement (Phase 4) runs when a send carries an acting user;
  // the default actor here is an OWNER.
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER"
  } as never);
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

  it("resolves the sending account by from address", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      from: "Support@Acme.com ",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    const where = prismaMock.sMTPConnection.findFirst.mock.calls[0][0].where;
    // Normalized like every other address at this door, and matched
    // case-insensitively so a differently-cased stored value still resolves.
    expect(where.fromEmail).toEqual({
      equals: "support@acme.com",
      mode: "insensitive"
    });
    expect(where.isDefault).toBeUndefined();
    expect(where.id).toBeUndefined();
  });

  it("prefers the default account when a from address matches several", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      from: "support@acme.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    // fromEmail is not unique within an org, so the tiebreak has to be
    // deterministic or the same send could go out as a different account.
    expect(prismaMock.sMTPConnection.findFirst.mock.calls[0][0].orderBy).toEqual([
      { isDefault: "desc" },
      { createdAt: "asc" }
    ]);
  });

  it("lets an explicit smtpConnectionId win over from", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      from: "support@acme.com",
      smtpConnectionId: "smtp_9",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    const where = prismaMock.sMTPConnection.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe("smtp_9");
    expect(where.fromEmail).toBeUndefined();
  });

  it("throws 404 rather than falling back when from matches no account", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);

    // A typo must not quietly send as the org default.
    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        from: "typo@acme.com",
        subject: "Hi",
        html: "<p>Hi</p>"
      })
    ).rejects.toThrow("No sending account sends as typo@acme.com");
    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
  });

  it("falls back to the org default when neither selector is given", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    const where = prismaMock.sMTPConnection.findFirst.mock.calls[0][0].where;
    expect(where.isDefault).toBe(true);
    expect(where.fromEmail).toBeUndefined();
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

  it("records a SUPPRESSED job and does not enqueue a suppressed recipient", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.suppression.findUnique.mockResolvedValue({ id: "s1" } as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_sup",
      status: "SUPPRESSED"
    } as never);

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "blocked@y.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    expect(result).toEqual({ id: "job_sup", status: "SUPPRESSED" });
    expect(prismaMock.emailJob.create.mock.calls[0][0].data).toMatchObject({
      status: "SUPPRESSED",
      toEmail: "blocked@y.com"
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("bypasses the suppression check for SYSTEM mail", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    // Even a suppressed recipient must receive account mail.
    prismaMock.suppression.findUnique.mockResolvedValue({ id: "s1" } as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_sys",
      status: "QUEUED"
    } as never);

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "blocked@y.com",
      subject: "Reset your password",
      html: "<p>Reset</p>",
      origin: "SYSTEM",
      createdByUserId: "user_1"
    });

    expect(result).toEqual({ id: "job_sys", status: "QUEUED" });
    // The suppression list is never consulted for SYSTEM sends.
    expect(prismaMock.suppression.findUnique).not.toHaveBeenCalled();
    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.origin).toBe("SYSTEM");
    expect(createData.status).toBe("QUEUED");
    expect(queueAdd).toHaveBeenCalledOnce();
  });

  it("queues an immediate send with no delay instead of sending inline", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>"
    });

    expect(result).toEqual({ id: "job_1", status: "QUEUED" });
    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.status).toBe("QUEUED");
    expect(createData.scheduledAt).toBeNull();
    expect(queueAdd).toHaveBeenCalledOnce();
    const [jobName, payload, opts] = queueAdd.mock.calls[0];
    expect(jobName).toBe("send-email");
    expect(payload).toEqual({ emailJobId: "job_1" });
    expect(opts).toMatchObject({ delay: 0, jobId: "email-job_1", attempts: 3 });
  });

  it("queues a future email with the schedule delay", async () => {
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
    expect(queueAdd.mock.calls[0][2]).toMatchObject({
      delay: 60 * 60 * 1000,
      jobId: "email-job_1"
    });
    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.scheduledAt).toEqual(new Date("2026-01-01T01:00:00.000Z"));
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

    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("renders template variables into the queued job", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.template.findFirst.mockResolvedValue({
      id: "tpl_1",
      subject: "Hi {{ name }}",
      html: "<p>Hello {{ name }}</p>",
      text: "Hello {{ missing }}"
    } as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      templateId: "tpl_1",
      variables: { name: "World" }
    });

    expect(result).toEqual({ id: "job_1", status: "QUEUED" });
    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.subject).toBe("Hi World");
    expect(createData.html).toBe("<p>Hello World</p>");
    // Unknown variables render as empty strings.
    expect(createData.text).toBe("Hello ");
    expect(createData.templateId).toBe("tpl_1");
  });

  it("normalizes recipient casing and stores the send group", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: " Mixed@Case.COM ",
      cc: ["CC@Y.com"],
      bcc: ["BCC@Y.com"],
      subject: "Hi",
      html: "<p>Hi</p>",
      sendGroupId: "grp_1"
    });

    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.toEmail).toBe("mixed@case.com");
    expect(createData.cc).toEqual(["cc@y.com"]);
    expect(createData.bcc).toEqual(["bcc@y.com"]);
    expect(createData.sendGroupId).toBe("grp_1");
  });

  it("persists cc, bcc, replyTo and origin on the queued job", async () => {
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
      html: "<p>Hi</p>"
    });

    const createData = prismaMock.emailJob.create.mock.calls[0][0].data;
    expect(createData.cc).toEqual(["cc@y.com"]);
    expect(createData.bcc).toEqual(["bcc@y.com"]);
    expect(createData.replyTo).toBe("reply@y.com");
    expect(createData.origin).toBe("TRANSACTIONAL");
    expect(createData.createdByUserId).toBeUndefined();
  });

  it("sets origin MANUAL and createdByUserId on the manual path", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

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

  // Phase 4 acceptance: a MEMBER without a grant cannot send as the account,
  // on any surface that funnels through this service (API JWT sends, manual).
  it("blocks a MEMBER without a grant from sending as the connection", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue(null);

    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        origin: "MANUAL",
        createdByUserId: "user_1"
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "send_as_denied" });
    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  // `from` resolves to a connection before the grant check, so naming an
  // account by address is not a way around one a MEMBER was never granted.
  it("blocks an ungranted MEMBER who names the account by from address", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue(null);

    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        from: "from@b.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        origin: "MANUAL",
        createdByUserId: "user_1"
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "send_as_denied" });
    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("lets a MEMBER with a grant send as the connection", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue({
      id: "g1"
    } as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await expect(
      transactionalEmailService.send({
        organizationId: "org_1",
        to: "x@y.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        origin: "MANUAL",
        createdByUserId: "user_1"
      })
    ).resolves.toMatchObject({ status: "QUEUED" });
  });

  it("links attachments to the queued job without loading their blobs", async () => {
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
      html: "<p>Hi</p>",
      attachmentIds: ["att_1"]
    });

    // Links only unlinked rows in this org to the new job.
    expect(prismaMock.emailAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["att_1"] }, organizationId: "org_1", emailJobId: null },
      data: { emailJobId: "job_1" }
    });
    // Blobs are loaded by the worker at send time, never at enqueue time.
    expect(storageGetObject).not.toHaveBeenCalled();
  });

  it("replays a prior job for a repeated idempotency key without enqueuing again", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      id: "job_existing",
      status: "SENT"
    } as never);

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      idempotencyKey: "key-1"
    });

    expect(result).toEqual({ id: "job_existing", status: "SENT" });
    // Short-circuits before any work: no SMTP lookup, no job created, no enqueue.
    expect(prismaMock.sMTPConnection.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("stores the idempotency key on a first-time send", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(null as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    prismaMock.emailJob.create.mockResolvedValue({
      id: "job_1",
      status: "QUEUED"
    } as never);

    await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      idempotencyKey: "key-1"
    });

    expect(prismaMock.emailJob.create.mock.calls[0][0].data.idempotencyKey).toBe(
      "key-1"
    );
    expect(queueAdd).toHaveBeenCalledOnce();
  });

  it("recovers from a concurrent duplicate (P2002) without a second enqueue", async () => {
    prismaMock.emailJob.findUnique
      .mockResolvedValueOnce(null as never) // pre-check: key not seen yet
      .mockResolvedValueOnce({
        id: "job_race",
        status: "QUEUED"
      } as never); // lookup after the unique-constraint conflict
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    // Shaped like the error the generated client actually throws: it comes from
    // the client's CJS copy of the runtime and so fails `instanceof` against the
    // class imported here (see lib/prisma-error.ts).
    prismaMock.emailJob.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
        clientVersion: "6.x",
        meta: { modelName: "EmailJob", target: ["organizationId", "idempotencyKey"] }
      })
    );

    const result = await transactionalEmailService.send({
      organizationId: "org_1",
      to: "x@y.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      idempotencyKey: "key-1"
    });

    expect(result).toEqual({ id: "job_race", status: "QUEUED" });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
