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
    buildUnsubscribeUrl: vi.fn(
      () => "https://app/api/v1/unsubscribe?token=tok"
    ),
    listUnsubscribeHeadersForUrl: vi.fn((url: string) => ({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    })),
    appendUnsubscribeFooter: vi.fn(
      (html: string | null) => `${html}+unsub-footer`
    ),
    appendUnsubscribeFooterText: vi.fn((text: string | null) =>
      text ? `${text}+unsub-text` : text
    ),
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
  buildUnsubscribeUrl: h.buildUnsubscribeUrl,
  listUnsubscribeHeadersForUrl: h.listUnsubscribeHeadersForUrl,
  appendUnsubscribeFooter: h.appendUnsubscribeFooter,
  appendUnsubscribeFooterText: h.appendUnsubscribeFooterText
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
  replyTo: null as string | null,
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
  h.buildUnsubscribeUrl.mockClear();
  h.listUnsubscribeHeadersForUrl.mockClear();
  h.appendUnsubscribeFooter.mockClear();
  h.appendUnsubscribeFooterText.mockClear();
  decryptSecret.mockClear();
  settleRunIfComplete.mockReset().mockResolvedValue(undefined);
  // Default: no attachments. Tests override this to assert forwarding.
  h.loadAttachmentsForJob.mockReset().mockResolvedValue(undefined);
  // Default: domain throttle allows the send. Tests override to assert holding.
  reserveDomainSlot.mockReset().mockResolvedValue({ allowed: true });
  classifyBounce.mockReset().mockReturnValue("HARD");
  // Default: no suppressed CC/BCC copies. Tests override to assert stripping.
  prismaMock.suppression.findMany.mockResolvedValue([] as never);
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

  it("matches a suppression case-insensitively (lookup is lowercased)", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      toEmail: "Mixed@Example.com"
    } as never);
    prismaMock.suppression.findUnique.mockResolvedValue({ id: "s1" } as never);

    await run(makeJob());

    // The unique lookup normalizes to the stored lowercase form.
    expect(prismaMock.suppression.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_email: {
          organizationId: "org1",
          email: "mixed@example.com"
        }
      },
      select: { id: true }
    });
    expect(send).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.update).toHaveBeenCalledWith({
      where: { id: "ej1" },
      data: { status: "SUPPRESSED" }
    });
  });

  it("sends SYSTEM mail to a suppressed recipient (suppression bypass)", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "SYSTEM"
    } as never);
    // A suppression row exists, but SYSTEM mail must still go out.
    prismaMock.suppression.findUnique.mockResolvedValue({ id: "s1" } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid-sys",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    // The suppression list is never even consulted.
    expect(prismaMock.suppression.findUnique).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(prismaMock.emailJob.update).not.toHaveBeenCalledWith({
      where: { id: "ej1" },
      data: { status: "SUPPRESSED" }
    });
  });

  it("does not inject tracking into SYSTEM mail", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "SYSTEM"
    } as never);
    prismaMock.suppression.findUnique.mockResolvedValue(null as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid-sys",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(injectTracking).not.toHaveBeenCalled();
    // The stored body is delivered verbatim (account links untouched).
    expect(send.mock.calls[0][0].html).toBe("<p>Body</p>");
    // And SYSTEM mail never carries List-Unsubscribe headers.
    expect(send.mock.calls[0][0].headers).toBeUndefined();
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

  // The sending account's default Reply-To. Resolved in the worker rather than
  // at job creation, so it reaches every origin — campaign fan-out and
  // recurring runs never set the column at all.
  it("falls back to the sending account's Reply-To when the job has none", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      replyTo: null,
      smtpConnection: { ...smtpConnection, replyTo: "support@example.com" }
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "support@example.com" })
    );
  });

  it("lets the job's own Reply-To win over the account default", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      replyTo: "thisone@example.com",
      smtpConnection: { ...smtpConnection, replyTo: "support@example.com" }
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "thisone@example.com" })
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

  it("adds List-Unsubscribe headers for bulk mail (campaign or recurring)", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "MANUAL",
      isBulk: true
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(h.buildUnsubscribeUrl).toHaveBeenCalledWith(
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

  it("omits List-Unsubscribe headers for non-bulk mail", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "TRANSACTIONAL",
      isBulk: false
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(h.buildUnsubscribeUrl).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].headers).toBeUndefined();
  });

  it("appends the unsubscribe footer to bulk mail, after tracking injection", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "CAMPAIGN",
      isBulk: true
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    // Order matters: the footer wraps the *tracked* HTML, so the opt-out link
    // is the one link in the message the click redirect never rewrites.
    expect(h.appendUnsubscribeFooter).toHaveBeenCalledWith(
      "tracked:<p>Body</p>",
      "https://app/api/v1/unsubscribe?token=tok"
    );
    const sendArgs = send.mock.calls[0][0];
    expect(sendArgs.html).toBe("tracked:<p>Body</p>+unsub-footer");
    // The plaintext half carries the same opt-out.
    expect(sendArgs.text).toBe("Body+unsub-text");
  });

  it("leaves non-bulk mail without any footer", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "TRANSACTIONAL",
      isBulk: false
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(h.appendUnsubscribeFooter).not.toHaveBeenCalled();
    expect(h.appendUnsubscribeFooterText).not.toHaveBeenCalled();
    const sendArgs = send.mock.calls[0][0];
    expect(sendArgs.html).toBe("tracked:<p>Body</p>");
    expect(sendArgs.text).toBe("Body");
  });

  it("strips suppressed CC/BCC addresses and records what was stripped", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      cc: ["keep@example.com", "Blocked@example.com"],
      bcc: ["hidden@example.com"]
    } as never);
    // To recipient is not suppressed; the CC "blocked@example.com" is.
    prismaMock.suppression.findUnique.mockResolvedValue(null as never);
    prismaMock.suppression.findMany.mockResolvedValue([
      { email: "blocked@example.com" }
    ] as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    const sendArgs = send.mock.calls[0][0];
    expect(sendArgs.cc).toEqual(["keep@example.com"]);
    expect(sendArgs.bcc).toEqual(["hidden@example.com"]);

    // The strip is recorded on the SENT event's metadata.
    const sentUpdate = prismaMock.emailJob.update.mock.calls.find(
      (call) => call[0].data?.status === "SENT"
    );
    expect(sentUpdate?.[0].data.events.create.metadata).toMatchObject({
      strippedCc: ["Blocked@example.com"]
    });
  });

  it("does not screen CC/BCC for SYSTEM mail", async () => {
    prismaMock.emailJob.findUnique.mockResolvedValue({
      ...baseEmailJob,
      origin: "SYSTEM",
      cc: ["copy@example.com"]
    } as never);
    send.mockResolvedValue({
      provider: "smtp",
      messageId: "mid1",
      accepted: ["to@example.com"],
      rejected: []
    });

    await run(makeJob());

    expect(prismaMock.suppression.findMany).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].cc).toEqual(["copy@example.com"]);
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
    // No FAILED event yet: a send with retries left has not failed. Writing one
    // per attempt left three rows behind for one failure, so anything counting
    // failures through events saw one send fail three times.
    expect(
      (failCall![0] as { data: { events?: unknown } }).data.events
    ).toBeUndefined();
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
    // One event, on the attempt that gives up, carrying how many it took — the
    // retry history the per-attempt rows used to record.
    expect(
      (
        failCall![0] as {
          data: { events: { create: { metadata: { attempts: number } } } };
        }
      ).data.events.create.metadata.attempts
    ).toBe(3);
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
