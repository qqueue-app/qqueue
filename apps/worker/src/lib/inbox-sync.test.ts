import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

// A controllable stand-in for the ImapFlow client. Tests drive its behaviour
// through `h.state` (mailbox shape, fetched messages, connect failures) and
// assert on the recorded connect/close calls and captured config.
const h = vi.hoisted(() => {
  const state = {
    mailbox: { exists: 0, uidNext: 1 } as { exists: number; uidNext: number },
    messages: [] as Array<{
      uid: number;
      flags?: Set<string>;
      internalDate?: Date;
      source?: Buffer | string;
    }>,
    connectCalls: 0,
    closeCalls: 0,
    connectError: null as Error | null,
    lastConfig: undefined as unknown
  };
  const simpleParser = vi.fn();
  const storage = { putObject: vi.fn(), getObject: vi.fn() };
  class ImapFlow {
    constructor(config: unknown) {
      state.lastConfig = config;
    }
    async connect() {
      state.connectCalls++;
      if (state.connectError) {
        throw state.connectError;
      }
    }
    async mailboxOpen() {
      return state.mailbox;
    }
    async *fetch() {
      for (const message of state.messages) {
        yield message;
      }
    }
    close() {
      state.closeCalls++;
    }
  }
  return { state, simpleParser, storage, ImapFlow };
});

vi.mock("imapflow", () => ({ ImapFlow: h.ImapFlow }));
vi.mock("mailparser", () => ({ simpleParser: h.simpleParser }));
vi.mock("./crypto.js", () => ({ decryptSecret: (v: string) => `dec:${v}` }));
vi.mock("./storage.js", () => ({ storage: h.storage }));
// dsn.ts runs for real; only its webhook fan-out (which would pull in BullMQ)
// is stubbed.
vi.mock("./outbound-webhooks.js", () => ({
  enqueueLatestWebhookDeliveries: vi.fn()
}));

const { syncInboxAccount, syncInboxAccounts } = await import("./inbox-sync.js");

type Account = Parameters<typeof syncInboxAccount>[0];

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    organizationId: "org-1",
    name: "Support",
    email: "support@acme.test",
    host: "imap.acme.test",
    port: 993,
    secure: true,
    usernameEncrypted: "enc-user",
    passwordEncrypted: "enc-pass",
    mailbox: "INBOX",
    status: "ACTIVE",
    lastSyncedAt: null,
    lastSeenUid: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

beforeEach(() => {
  h.state.mailbox = { exists: 0, uidNext: 1 };
  h.state.messages = [];
  h.state.connectCalls = 0;
  h.state.closeCalls = 0;
  h.state.connectError = null;
  h.state.lastConfig = undefined;
  h.simpleParser.mockReset();
  // The upsert's return value is now used (attachments hang off the stored
  // message id), so it needs a row rather than the deep mock's undefined.
  prismaMock.inboundMessage.upsert.mockResolvedValue({ id: "msg-1" } as never);
  prismaMock.inboundAttachment.findMany.mockResolvedValue([] as never);
  h.storage.putObject.mockReset();
  h.storage.putObject.mockResolvedValue(undefined);
});

describe("syncInboxAccounts", () => {
  it("queries only ACTIVE accounts and does nothing when there are none", async () => {
    prismaMock.inboxAccount.findMany.mockResolvedValue([]);

    await syncInboxAccounts();

    expect(prismaMock.inboxAccount.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE" }
    });
    expect(h.state.connectCalls).toBe(0);
  });

  it("scopes the query by id and syncs each returned account", async () => {
    prismaMock.inboxAccount.findMany.mockResolvedValue([makeAccount()] as never);
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    h.state.mailbox = { exists: 1, uidNext: 6 };
    h.state.messages = [{ uid: 5, source: Buffer.from("raw") }];
    h.simpleParser.mockResolvedValue({ from: { value: [{ address: "a@b.co" }] } });

    await syncInboxAccounts("acc-1");

    expect(prismaMock.inboxAccount.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE", id: "acc-1" }
    });
    expect(h.state.connectCalls).toBe(1);
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("syncInboxAccount", () => {
  it("builds the client from decrypted credentials", async () => {
    h.state.mailbox = { exists: 0, uidNext: 1 };

    await syncInboxAccount(makeAccount());

    expect(h.state.lastConfig).toMatchObject({
      host: "imap.acme.test",
      port: 993,
      secure: true,
      auth: { user: "dec:enc-user", pass: "dec:enc-pass" }
    });
  });

  it("stores a parsed reply, links its outbound thread, and advances lastSeenUid", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue({ id: "job-1" } as never);
    h.state.mailbox = { exists: 3, uidNext: 11 };
    h.state.messages = [
      {
        uid: 7,
        flags: new Set(["\\Seen"]),
        internalDate: new Date("2026-02-01T09:00:00.000Z"),
        source: Buffer.from("raw")
      }
    ];
    h.simpleParser.mockResolvedValue({
      messageId: "<msg-7@example.com>",
      inReplyTo: "<orig@example.com>",
      references: ["<a@x>", "<orig@example.com>"],
      from: { value: [{ address: "Sender@Example.com", name: "Sender" }] },
      to: { value: [{ address: "To1@x.com" }, { address: "To2@x.com" }] },
      cc: [{ value: [{ address: "Cc@x.com" }] }],
      subject: "Re: Hello",
      text: "hi",
      html: "<p>hi</p>",
      date: new Date("2026-02-01T10:00:00.000Z")
    });

    await syncInboxAccount(makeAccount({ lastSeenUid: 0 }));

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        messageId: { in: ["<orig@example.com>", "<a@x>", "<orig@example.com>"] }
      },
      select: { id: true }
    });

    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({
      inboxAccountId_messageId: {
        inboxAccountId: "acc-1",
        messageId: "<msg-7@example.com>"
      }
    });
    expect(upsertArg.create).toMatchObject({
      organizationId: "org-1",
      inboxAccountId: "acc-1",
      emailJobId: "job-1",
      messageId: "<msg-7@example.com>",
      references: ["<a@x>", "<orig@example.com>"],
      fromEmail: "sender@example.com",
      fromName: "Sender",
      to: ["to1@x.com", "to2@x.com"],
      cc: ["cc@x.com"],
      subject: "Re: Hello",
      html: "<p>hi</p>",
      receivedAt: new Date("2026-02-01T10:00:00.000Z"),
      readAt: new Date("2026-02-01T10:00:00.000Z"),
      imapUid: 7
    });

    expect(prismaMock.inboxAccount.update).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: expect.objectContaining({ lastSeenUid: 7 })
    });
    expect(h.state.closeCalls).toBe(1);
  });

  it("skips sourceless messages and falls back for sparse mail", async () => {
    h.state.mailbox = { exists: 2, uidNext: 21 };
    h.state.messages = [
      { uid: 18 }, // no source -> skipped, simpleParser never called for it
      { uid: 19, internalDate: new Date("2026-03-01T00:00:00.000Z"), source: "raw" }
    ];
    h.simpleParser.mockResolvedValue({
      // no messageId, from, to, cc, references, inReplyTo, date; html not a string
      html: false,
      subject: undefined
    });

    await syncInboxAccount(makeAccount({ lastSeenUid: 10 }));

    expect(h.simpleParser).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();

    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(upsertArg.create).toMatchObject({
      messageId: "acc-1:19", // fallback id
      emailJobId: undefined,
      fromEmail: "unknown@example.invalid",
      fromName: undefined,
      to: [],
      cc: [],
      subject: "",
      references: [],
      html: undefined,
      receivedAt: new Date("2026-03-01T00:00:00.000Z"), // from internalDate
      readAt: undefined, // no \Seen flag
      imapUid: 19
    });
  });

  it("normalizes a single-string References header", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    h.state.mailbox = { exists: 1, uidNext: 4 };
    h.state.messages = [{ uid: 3, source: "raw" }];
    h.simpleParser.mockResolvedValue({
      references: "<solo@example.com>",
      from: { value: [{ address: "x@y.co" }] }
    });

    await syncInboxAccount(makeAccount());

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messageId: { in: ["<solo@example.com>"] }
        })
      })
    );
    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(upsertArg.create.references).toEqual(["<solo@example.com>"]);
  });

  it("does not fetch when the mailbox is empty but still records the sync", async () => {
    h.state.mailbox = { exists: 0, uidNext: 50 };
    h.state.messages = [{ uid: 5, source: "raw" }];

    await syncInboxAccount(makeAccount({ lastSeenUid: 0 }));

    expect(h.simpleParser).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessage.upsert).not.toHaveBeenCalled();
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledTimes(1);
    expect(h.state.closeCalls).toBe(1);
  });

  it("closes the client even when connecting fails", async () => {
    h.state.connectError = new Error("connection refused");

    await expect(syncInboxAccount(makeAccount())).rejects.toThrow(
      "connection refused"
    );
    expect(h.state.closeCalls).toBe(1);
    expect(prismaMock.inboxAccount.update).not.toHaveBeenCalled();
  });
});

// These parts used to be parsed and discarded, so a received PDF simply never
// appeared anywhere in the app.
describe("inbound attachments", () => {
  function messageWithAttachments(attachments: unknown[]) {
    h.state.mailbox = { exists: 1, uidNext: 6 };
    h.state.messages = [{ uid: 5, source: "raw" }];
    h.simpleParser.mockResolvedValue({
      from: { value: [{ address: "a@b.co" }] },
      attachments
    });
  }

  it("stores each attachment's blob and metadata", async () => {
    messageWithAttachments([
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        content: Buffer.from("pdf-bytes"),
        cid: "cid-1",
        contentDisposition: "attachment"
      }
    ]);

    await syncInboxAccount(makeAccount());

    expect(h.storage.putObject).toHaveBeenCalledTimes(1);
    const put = h.storage.putObject.mock.calls[0][0];
    expect(put.contentType).toBe("application/pdf");
    expect(put.key).toMatch(/^inbound\/org-1\/.*-report\.pdf$/);

    expect(prismaMock.inboundAttachment.create).toHaveBeenCalledTimes(1);
    const created = prismaMock.inboundAttachment.create.mock.calls[0][0];
    expect(created.data).toMatchObject({
      organizationId: "org-1",
      inboundMessageId: "msg-1",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: Buffer.from("pdf-bytes").length,
      contentId: "cid-1",
      isInline: false
    });
  });

  it("marks inline parts so they aren't listed as downloads", async () => {
    messageWithAttachments([
      {
        filename: "logo.png",
        contentType: "image/png",
        content: Buffer.from("png"),
        cid: "logo",
        contentDisposition: "inline"
      }
    ]);

    await syncInboxAccount(makeAccount());

    expect(
      prismaMock.inboundAttachment.create.mock.calls[0][0].data.isInline
    ).toBe(true);
  });

  it("strips path components from a hostile filename", async () => {
    messageWithAttachments([
      {
        filename: "../../etc/passwd",
        contentType: "text/plain",
        content: Buffer.from("x")
      }
    ]);

    await syncInboxAccount(makeAccount());

    const created = prismaMock.inboundAttachment.create.mock.calls[0][0];
    expect(created.data.filename).toBe("passwd");
    expect(h.storage.putObject.mock.calls[0][0].key).not.toContain("..");
  });

  it("skips oversized parts without failing the sync", async () => {
    messageWithAttachments([
      {
        filename: "huge.bin",
        contentType: "application/octet-stream",
        // env default ceiling is 25MB.
        content: Buffer.alloc(26 * 1024 * 1024)
      }
    ]);

    await syncInboxAccount(makeAccount());

    expect(h.storage.putObject).not.toHaveBeenCalled();
    expect(prismaMock.inboundAttachment.create).not.toHaveBeenCalled();
    // The message itself is still stored and the sync still advances.
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledTimes(1);
  });

  it("keeps the message when storing a blob fails", async () => {
    messageWithAttachments([
      {
        filename: "a.txt",
        contentType: "text/plain",
        content: Buffer.from("x")
      }
    ]);
    h.storage.putObject.mockRejectedValue(new Error("s3 down"));

    await syncInboxAccount(makeAccount());

    expect(prismaMock.inboundAttachment.create).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate attachments when the same message is re-synced", async () => {
    messageWithAttachments([
      {
        filename: "a.txt",
        contentType: "text/plain",
        content: Buffer.from("x")
      }
    ]);
    prismaMock.inboundAttachment.findMany.mockResolvedValue([
      { id: "existing" }
    ] as never);

    await syncInboxAccount(makeAccount());

    expect(h.storage.putObject).not.toHaveBeenCalled();
    expect(prismaMock.inboundAttachment.create).not.toHaveBeenCalled();
  });
});

// Phase 2b: bounces that arrive after the SMTP conversation (DSN emails from
// receiving servers) used to be stored as ordinary inbound rows with zero
// bounce logic — permanently invisible to suppression.
describe("DSN handling", () => {
  function syncWithParsedMail(mail: unknown) {
    h.state.mailbox = { exists: 1, uidNext: 6 };
    h.state.messages = [{ uid: 5, source: "raw" }];
    h.simpleParser.mockResolvedValue(mail);
  }

  const dsnMail = {
    messageId: "<dsn-1@mx.example.test>",
    from: {
      value: [
        { address: "mailer-daemon@mx.example.test", name: "Mail Delivery System" }
      ]
    },
    subject: "Delivery Status Notification (Failure)",
    text: [
      "Reporting-MTA: dns; mx.example.test",
      "",
      "Final-Recipient: rfc822; bob@example.com",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
      ""
    ].join("\n")
  };

  it("flags a first-seen DSN, fails the SENT job, and suppresses the recipient", async () => {
    syncWithParsedMail(dsnMail);
    // No In-Reply-To/References and no returned original, so correlation lands
    // on the most recent SENT job to the failed address.
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job-9",
      status: "SENT",
      campaignRunId: null
    } as never);

    await syncInboxAccount(makeAccount());

    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(upsertArg.create.isDsn).toBe(true);

    expect(prismaMock.emailEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        emailJobId: "job-9",
        type: "BOUNCED",
        metadata: expect.objectContaining({
          source: "dsn",
          correlation: "recipient-recency",
          finalRecipient: "bob@example.com",
          bounceType: "HARD"
        })
      })
    });
    expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-9", status: "SENT" },
      data: { status: "FAILED" }
    });
    expect(prismaMock.suppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          email: "bob@example.com",
          reason: "BOUNCE"
        })
      })
    );
    // The sync itself still completes normally.
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledTimes(1);
  });

  it("re-syncing the same DSN stores the row but repeats no bounce side effects", async () => {
    syncWithParsedMail(dsnMail);
    prismaMock.inboundMessage.findUnique.mockResolvedValue({
      id: "msg-1"
    } as never);

    await syncInboxAccount(makeAccount());

    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(upsertArg.update.isDsn).toBe(true);
    expect(prismaMock.emailEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.emailJob.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
  });

  it("stores ordinary mail with isDsn false and no bounce processing", async () => {
    syncWithParsedMail({
      messageId: "<reply-1@example.com>",
      from: { value: [{ address: "human@example.com" }] },
      subject: "Re: Hello",
      text: "Sounds good!"
    });

    await syncInboxAccount(makeAccount());

    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(upsertArg.create.isDsn).toBe(false);
    expect(prismaMock.emailEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.suppression.upsert).not.toHaveBeenCalled();
  });

  it("contains a DSN processing failure instead of crashing the sync", async () => {
    syncWithParsedMail(dsnMail);
    prismaMock.emailJob.findFirst.mockRejectedValue(new Error("db down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await syncInboxAccount(makeAccount());

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("failed to process DSN"),
      expect.any(Error)
    );
    // The message is stored and the account's cursor still advances.
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
