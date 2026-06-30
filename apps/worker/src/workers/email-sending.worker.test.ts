import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const h = vi.hoisted(() => {
  class DelayedError extends Error {
    constructor() {
      super("delayed");
      this.name = "DelayedError";
    }
  }
  let capturedProcessor:
    | ((
        job: {
          data: { emailJobId: string };
          attemptsMade: number;
          opts: { attempts?: number };
          moveToDelayed: (ts: number, token?: string) => Promise<void>;
        },
        token?: string
      ) => Promise<unknown>)
    | undefined;
  const send = vi.fn();
  return {
    DelayedError,
    getProcessor: () => capturedProcessor,
    setProcessor: (p: typeof capturedProcessor) => {
      capturedProcessor = p;
    },
    send,
    SMTPProvider: vi.fn(() => ({ send })),
    classifyBounce: vi.fn(() => "HARD" as "HARD" | "SOFT" | "BLOCK"),
    injectTracking: vi.fn((html: string | null) => `tracked:${html}`),
    buildListUnsubscribeHeaders: vi.fn(() => ({
      "List-Unsubscribe": "<https://app/api/v1/unsubscribe?token=tok>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    })),
    decryptSecret: vi.fn((v: string) => `dec:${v}`),
    settleRunIfComplete: vi.fn(),
    loadAttachmentsForJob: vi.fn(),
    reserveDomainSlot: vi.fn(async () => ({ allowed: true }))
  };
});

const DelayedError = h.DelayedError;
const {
  send,
  SMTPProvider,
  classifyBounce,
  injectTracking,
  decryptSecret,
  settleRunIfComplete,
  reserveDomainSlot
} = h;

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: vi.fn() })),
  Worker: vi.fn((_name: string, processor: never) => {
    h.setProcessor(processor);
    return { name: _name };
  }),
  DelayedError: h.DelayedError
}));

vi.mock("../config/redis.js", () => ({ redisConnection: {} }));

vi.mock("@qqueue/email-engine", () => ({
  SMTPProvider: h.SMTPProvider,
  classifyBounce: h.classifyBounce,
  injectTracking: h.injectTracking,
  buildListUnsubscribeHeaders: h.buildListUnsubscribeHeaders
}));

vi.mock("../lib/crypto.js", () => ({ decryptSecret: h.decryptSecret }));

vi.mock("../lib/campaign-run.js", () => ({
  settleRunIfComplete: h.settleRunIfComplete
}));

vi.mock("../lib/attachments.js", () => ({
  loadAttachmentsForJob: h.loadAttachmentsForJob
}));

vi.mock("../lib/throttle.js", () => ({
  reserveDomainSlot: h.reserveDomainSlot
}));

import { startEmailSendingWorker } from "./email-sending.worker.js";

function makeJob(overrides: Partial<{
  emailJobId: string;
  attemptsMade: number;
  attempts: number;
}> = {}) {
  return {
    data: { emailJobId: overrides.emailJobId ?? "ej1" },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
    moveToDelayed: vi.fn().mockResolvedValue(undefined)
  };
}

function run(job: ReturnType<typeof makeJob>, token = "tok") {
  startEmailSendingWorker();
  const processor = h.getProcessor();
  if (!processor) {
    throw new Error("processor not captured");
  }
  return processor(job, token);
}

const smtpConnection = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  fromEmail: "from@example.com",
  fromName: "Sender",
  usernameEncrypted: "u-enc",
  passwordEncrypted: "p-enc"
};

const secretDecryptionMessage =
  "Stored SMTP credentials cannot be decrypted. Check ENCRYPTION_KEY; changing it invalidates existing SMTP credentials.";

const baseEmailJob = {
  id: "ej1",
  status: "QUEUED",
  organizationId: "org1",
  campaignRunId: "run1",
  toEmail: "to@example.com",
  cc: [] as string[],
  bcc: [] as string[],
  replyTo: null as string | null,
  inReplyTo: null as string | null,
  references: [] as string[],
  subject: "Subject",
  html: "<p>Body</p>",
  text: "Body",
  smtpConnection,
  campaign: { status: "SENDING" }
};

beforeEach(() => {
  send.mockReset();
  SMTPProvider.mockClear();
  injectTracking.mockClear();
  h.buildListUnsubscribeHeaders.mockClear();
  decryptSecret.mockClear();
  settleRunIfComplete.mockReset().mockResolvedValue(undefined);
  // Default: no attachments. Tests override this to assert forwarding.
  h.loadAttachmentsForJob.mockReset().mockResolvedValue(undefined);
  // Default: domain throttle allows the send. Tests override to assert holding.
  reserveDomainSlot.mockReset().mockResolvedValue({ allowed: true });
  classifyBounce.mockReset().mockReturnValue("HARD");
});

describe("email-sending worker", () => {
  it("starts a Worker for the email-sending queue", () => {
    const worker = startEmailSendingWorker();
    expect(worker).toMatchObject({ name: "email-sending" });
  });

  it("does nothing when the email job is missing", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(null as never);
    await run(makeJob());
    expect(prismaMock.emailJob.update).not.toHaveBeenCalled();
  });

  it("uses the sender identity's From and signs DKIM for a managed verified domain", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      senderIdentity: {
        fromEmail: "noreply@acme.com",
        fromName: "Acme",
        replyTo: "support@acme.com",
        sendingDomain: {
          domain: "acme.com",
          dkimMode: "MANAGED",
          dkimStatus: "VERIFIED",
          dkimSelector: "qqueue",
          dkimPrivateKeyEncrypted: "pk-enc"
        }
      }
    } as never);
    send.mockResolvedValue({
      messageId: "m1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.from).toBe("Acme <noreply@acme.com>");
    expect(payload.replyTo).toBe("support@acme.com");
    expect(payload.dkim).toEqual({
      domainName: "acme.com",
      keySelector: "qqueue",
      privateKey: "dec:pk-enc"
    });
  });

  it("does not sign DKIM for a legacy job without a sender identity", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    send.mockResolvedValue({
      messageId: "m2",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    const payload = send.mock.calls[0][0];
    expect(payload.from).toBe("Sender <from@example.com>");
    expect(payload.dkim).toBeUndefined();
  });

  it("does nothing for a CANCELLED job", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      status: "CANCELLED"
    } as never);
    await run(makeJob());
    expect(send).not.toHaveBeenCalled();
  });

  it("delays the job and throws DelayedError when the campaign is PAUSED", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      campaign: { status: "PAUSED" }
    } as never);
    const job = makeJob();

    await expect(run(job, "tok")).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok");
    expect(prismaMock.emailJob.update).not.toHaveBeenCalled();
  });

  it("throws when the job has no SMTP connection", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      smtpConnection: null
    } as never);
    await expect(run(makeJob())).rejects.toThrow(
      "Email job requires an SMTP connection"
    );
  });

  it("marks SUPPRESSED and skips sending when the recipient is suppressed", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    prismaMock.suppression.findUnique.mockResolvedValue({ id: "s1" } as never);

    await run(makeJob());

    expect(send).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.update).toHaveBeenCalledWith({
      where: { id: "ej1" },
      data: { status: "SUPPRESSED" }
    });
    // Never transitions to PROCESSING.
    expect(prismaMock.emailJob.update).not.toHaveBeenCalledWith({
      where: { id: "ej1" },
      data: { status: "PROCESSING" }
    });
    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
  });

  it("holds the job (DelayedError) when the recipient domain is over its throttle", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    prismaMock.suppression.findUnique.mockResolvedValue(null as never);
    reserveDomainSlot.mockResolvedValue({ allowed: false, retryInMs: 5_000 });
    const job = makeJob();

    await expect(run(job, "tok")).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok");
    expect(send).not.toHaveBeenCalled();
    // Never transitions to PROCESSING while held.
    expect(prismaMock.emailJob.update).not.toHaveBeenCalledWith({
      where: { id: "ej1" },
      data: { status: "PROCESSING" }
    });
  });

  it("sends successfully, records SENT and settles the run", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    // Marks processing first.
    expect(prismaMock.emailJob.update).toHaveBeenCalledWith({
      where: { id: "ej1" },
      data: { status: "PROCESSING" }
    });
    // Builds the provider from decrypted creds.
    expect(decryptSecret).toHaveBeenCalledWith("u-enc");
    expect(decryptSecret).toHaveBeenCalledWith("p-enc");
    expect(SMTPProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        auth: { user: "dec:u-enc", pass: "dec:p-enc" }
      })
    );
    // Injects tracking and sends with a formatted From.
    expect(injectTracking).toHaveBeenCalledWith("<p>Body</p>", expect.any(Object));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Sender <from@example.com>",
        to: "to@example.com",
        html: "tracked:<p>Body</p>"
      })
    );
    // Records the SENT status.
    const sentCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "SENT"
    );
    expect(sentCall).toBeDefined();
    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
  });

  it("forwards cc, bcc and replyTo to the provider when present", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      replyTo: "reply@example.com"
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"],
        replyTo: "reply@example.com"
      })
    );
  });

  it("forwards threading headers (inReplyTo, references) to the provider", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      inReplyTo: "<parent@mail>",
      references: ["<root@mail>", "<parent@mail>"]
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: "<parent@mail>",
        references: ["<root@mail>", "<parent@mail>"]
      })
    );
  });

  it("loads and forwards attachments to the provider", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    const attachments = [
      {
        filename: "report.pdf",
        content: Buffer.from("PDF"),
        contentType: "application/pdf"
      }
    ];
    h.loadAttachmentsForJob.mockResolvedValue(attachments);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(h.loadAttachmentsForJob).toHaveBeenCalledWith("ej1");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ attachments })
    );
  });

  it("omits cc, bcc and replyTo for jobs without them (unchanged behavior)", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    const sendArgs = send.mock.calls[0][0];
    expect(sendArgs.cc).toBeUndefined();
    expect(sendArgs.bcc).toBeUndefined();
    expect(sendArgs.replyTo).toBeUndefined();
    expect(sendArgs.inReplyTo).toBeUndefined();
    expect(sendArgs.references).toBeUndefined();
  });

  it("adds List-Unsubscribe headers for CAMPAIGN origin", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "CAMPAIGN"
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(h.buildListUnsubscribeHeaders).toHaveBeenCalledWith(
      expect.any(String),
      "org1",
      "to@example.com",
      expect.any(String)
    );
    const sendArgs = send.mock.calls[0][0];
    expect(sendArgs.headers).toMatchObject({
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    });
  });

  it("omits List-Unsubscribe headers for non-campaign origin", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "TRANSACTIONAL"
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(h.buildListUnsubscribeHeaders).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].headers).toBeUndefined();
  });

  it("uses bare fromEmail when fromName is null", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      smtpConnection: { ...smtpConnection, fromName: null },
      text: null
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "from@example.com", text: undefined })
    );
  });

  it("marks FAILED and bounces the contact on a hard rejection", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    classifyBounce.mockReturnValueOnce("HARD");
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: [],
      rejected: ["to@example.com"],
      rejectionResponse: "550 5.1.1 No such user"
    });

    await run(makeJob());

    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "BOUNCED" } })
    );
    // A hard bounce adds the address to the suppression registry immediately,
    // without consulting the soft-bounce count.
    expect(prismaMock.suppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: "org1",
          email: "to@example.com",
          reason: "BOUNCE"
        })
      })
    );
    expect(prismaMock.emailEvent.count).not.toHaveBeenCalled();
    const failedCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "FAILED"
    );
    expect(failedCall).toBeDefined();
    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
  });

  it("records a soft bounce without suppressing below the threshold", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    classifyBounce.mockReturnValueOnce("SOFT");
    prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null as never);
    // One soft bounce so far (the just-recorded one); default threshold is 3.
    prismaMock.emailEvent.count.mockResolvedValue(1 as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: [],
      rejected: ["to@example.com"],
      rejectionResponse: "452 4.2.2 Mailbox full"
    });

    await run(makeJob());

    // FAILED (the delivery did fail) but NOT suppressed and contact untouched.
    const failedCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "FAILED"
    );
    expect(failedCall).toBeDefined();
    expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
    expect(prismaMock.contact.updateMany).not.toHaveBeenCalled();
    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
  });

  it("suppresses once soft bounces reach the threshold", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    classifyBounce.mockReturnValueOnce("SOFT");
    prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null as never);
    // Threshold (default 3) reached, counting the just-recorded soft bounce.
    prismaMock.emailEvent.count.mockResolvedValue(3 as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: [],
      rejected: ["to@example.com"],
      rejectionResponse: "452 4.2.2 Mailbox full"
    });

    await run(makeJob());

    expect(prismaMock.suppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ reason: "BOUNCE" })
      })
    );
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "BOUNCED" } })
    );
  });

  it("requeues (QUEUED) on a non-final failed attempt and rethrows", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    send.mockRejectedValue(new Error("connection refused"));

    await expect(run(makeJob({ attemptsMade: 0, attempts: 3 }))).rejects.toThrow(
      "connection refused"
    );

    const failCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "QUEUED"
    );
    expect(failCall).toBeDefined();
    expect(settleRunIfComplete).not.toHaveBeenCalled();
  });

  it("records a clear message when stored SMTP credentials cannot be decrypted", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    decryptSecret.mockImplementationOnce(() => {
      throw new Error(secretDecryptionMessage);
    });

    await expect(run(makeJob({ attemptsMade: 2, attempts: 3 }))).rejects.toThrow(
      "Stored SMTP credentials cannot be decrypted"
    );

    const failCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "FAILED"
    );
    expect(
      (failCall![0] as { data: { events: { create: { metadata: { message: string } } } } })
        .data.events.create.metadata.message
    ).toContain("changing it invalidates existing SMTP credentials");
  });

  it("marks FAILED and settles on the final failed attempt", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    send.mockRejectedValue(new Error("boom"));

    await expect(run(makeJob({ attemptsMade: 2, attempts: 3 }))).rejects.toThrow(
      "boom"
    );

    const failCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "FAILED"
    );
    expect(failCall).toBeDefined();
    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
  });

  it("uses a generic message for a non-Error throw", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    send.mockRejectedValue("string failure");

    await expect(run(makeJob({ attemptsMade: 2, attempts: 3 }))).rejects.toBe(
      "string failure"
    );

    const failCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "FAILED"
    );
    expect(
      (failCall![0] as { data: { events: { create: { metadata: { message: string } } } } })
        .data.events.create.metadata.message
    ).toBe("Unknown send error");
  });

  it("defaults attempts to 1 when opts.attempts is undefined (final attempt)", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue(baseEmailJob as never);
    send.mockRejectedValue(new Error("boom"));
    const job = {
      data: { emailJobId: "ej1" },
      attemptsMade: 0,
      opts: {},
      moveToDelayed: vi.fn()
    };

    startEmailSendingWorker();
    await expect(h.getProcessor()!(job as never, "tok")).rejects.toThrow(
      "boom"
    );

    const failCall = prismaMock.emailJob.update.mock.calls.find(
      (c) => (c[0] as { data: { status: string } }).data.status === "FAILED"
    );
    expect(failCall).toBeDefined();
    expect(settleRunIfComplete).toHaveBeenCalledWith("run1");
  });
});
