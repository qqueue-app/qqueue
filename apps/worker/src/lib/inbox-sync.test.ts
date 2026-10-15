import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

// A controllable stand-in for the ImapFlow client. Tests drive its behaviour
// through `h.state` (mailbox shape, fetched messages, connect failures) and
// assert on the recorded connect/close calls and captured config.
const h = vi.hoisted(() => {
  const state = {
    mailbox: { exists: 0, uidNext: 1 } as {
      exists: number;
      uidNext: number;
      uidValidity?: bigint;
    },
    currentPath: "INBOX",
    paths: ["INBOX"],
    byFolder: {} as Record<
      string,
      {
        exists: number;
        uidNext: number;
        uidValidity: bigint;
        messages: Array<{
          uid: number;
          source?: string;
          envelope?: { messageId?: string };
        }>;
      }
    >,
    messages: [] as Array<{
      uid: number;
      flags?: Set<string>;
      internalDate?: Date;
      source?: Buffer | string;
      envelope?: { messageId?: string };
    }>,
    fetches: [] as Array<{
      range: string | number[];
      source?: boolean;
      uid?: boolean;
    }>,
    connectCalls: 0,
    closeCalls: 0,
    connectError: null as Error | null,
    lastConfig: undefined as unknown,
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
    async list() {
      return state.paths.map((path) => ({
        path,
        name: path,
        flags: new Set<string>(),
        specialUse: path === "Sent" ? "\\Sent" : undefined,
      }));
    }
    async mailboxOpen(path: string) {
      state.currentPath = path;
      if (state.byFolder[path]) return state.byFolder[path];
      return {
        ...state.mailbox,
        uidValidity: state.mailbox.uidValidity ?? 99n,
      };
    }
    async search(query: { uid?: string }) {
      const [first, last] = (query.uid ?? "1:*")
        .split(":")
        .map((value) => (value === "*" ? Infinity : Number(value)));
      return {
        count: (
          state.byFolder[state.currentPath]?.messages ?? state.messages
        ).filter((message) => message.uid >= first && message.uid <= last)
          .length,
      };
    }
    async *fetch(
      range: string | number[],
      query: { source?: boolean },
      options?: { uid?: boolean }
    ) {
      state.fetches.push({ range, source: query.source, uid: options?.uid });
      for (const [index, message] of (
        state.byFolder[state.currentPath]?.messages ?? state.messages
      ).entries()) {
        const included = Array.isArray(range)
          ? range.includes(message.uid)
          : (() => {
              const [first, last] = range.split(":").map(Number);
              const identity = options?.uid ? message.uid : index + 1;
              return identity >= first && identity <= last;
            })();
        if (included) yield query.source ? message : { uid: message.uid };
      }
    }
    async fetchOne(uid: number) {
      return (
        (state.byFolder[state.currentPath]?.messages ?? state.messages).find(
          (message) => message.uid === uid
        ) ?? false
      );
    }
    close() {
      state.closeCalls++;
    }
  }
  return { state, simpleParser, storage, ImapFlow };
});

vi.mock("imapflow", () => ({ ImapFlow: h.ImapFlow }));
vi.mock("./push.js", () => ({ notifyNewInboundMessage: vi.fn() }));
vi.mock("./inbox-moves.js", () => ({
  processInboxMoves: vi.fn().mockResolvedValue(false),
}));
vi.mock("../queues/inbox-sync.queue.js", () => ({
  inboxSyncQueue: { add: vi.fn() },
}));
vi.mock("./inbox-read-state.js", () => ({
  synchronizeReadState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("mailparser", () => ({ simpleParser: h.simpleParser }));
vi.mock("./crypto.js", () => ({ decryptSecret: (v: string) => `dec:${v}` }));
vi.mock("./storage.js", () => ({ storage: h.storage }));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// dsn.ts runs for real; only its webhook fan-out (which would pull in BullMQ)
// is stubbed.
vi.mock("./outbound-webhooks.js", () => ({
  enqueueLatestWebhookDeliveries: vi.fn(),
}));

const { syncInboxAccount, syncInboxAccounts, storeAttachments } =
  await import("./inbox-sync.js");

type Account = Parameters<typeof syncInboxAccount>[0];

function makeAccount(overrides: Partial<Account> = {}): Account {
  const account = {
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
    uidValidity: null,
    lastSyncError: null,
    flagsCursor: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as Account;
  prismaMock.inboxAccount.findFirst.mockResolvedValue(account);
  prismaMock.inboxFolder.findMany.mockResolvedValue(
    [
      {
        id: "f1",
        path: account.mailbox,
        role: "INBOX",
        ...account,
        inboxAccountId: account.id,
      },
    ].map((folder) => ({ ...folder, id: "f1" })) as never
  );
  return account;
}

beforeEach(() => {
  prismaMock.$queryRaw.mockResolvedValue([{ locked: true }]);
  h.state.mailbox = { exists: 0, uidNext: 1 };
  h.state.messages = [];
  h.state.byFolder = {};
  h.state.paths = ["INBOX"];
  h.state.currentPath = "INBOX";
  h.state.fetches = [];
  h.state.connectCalls = 0;
  h.state.closeCalls = 0;
  h.state.connectError = null;
  h.state.lastConfig = undefined;
  h.simpleParser.mockReset();
  // The upsert's return value is now used (attachments hang off the stored
  // message id), so it needs a row rather than the deep mock's undefined.
  prismaMock.inboundMessage.upsert.mockImplementation(
    async (args) =>
      ({
        id: "msg-1",
        readAt: null,
        readRevision: 1,
        flagged: false,
        flagRevision: 1,
        ...args.create,
      }) as never
  );
  prismaMock.inboundAttachment.findMany.mockResolvedValue([] as never);
  prismaMock.inboundMessage.findMany.mockResolvedValue([]);
  prismaMock.inboundMessageLocation.findMany.mockResolvedValue([]);
  prismaMock.inboundAttachment.create.mockImplementation(
    async (args) => ({ id: "part-1", ...args.data }) as never
  );
  h.storage.putObject.mockReset();
  h.storage.putObject.mockResolvedValue(undefined);
});

describe("syncInboxAccounts", () => {
  it("queries only ACTIVE accounts and does nothing when there are none", async () => {
    prismaMock.inboxAccount.findMany.mockResolvedValue([]);

    await syncInboxAccounts();

    expect(prismaMock.inboxAccount.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE" },
    });
    expect(h.state.connectCalls).toBe(0);
  });

  it("scopes the query by id and syncs each returned account", async () => {
    prismaMock.inboxAccount.findMany.mockResolvedValue([
      makeAccount(),
    ] as never);
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    h.state.mailbox = { exists: 1, uidNext: 6 };
    h.state.messages = [{ uid: 5, source: Buffer.from("raw") }];
    h.simpleParser.mockResolvedValue({
      from: { value: [{ address: "a@b.co" }] },
    });

    await syncInboxAccounts("acc-1");

    expect(prismaMock.inboxAccount.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE", id: "acc-1" },
    });
    expect(h.state.connectCalls).toBe(1);
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("syncInboxAccount", () => {
  it("resets the UID cursor when the mailbox identity changes, including the first sync after upgrade", async () => {
    h.state.mailbox = { exists: 1, uidNext: 6, uidValidity: 99n };
    h.state.messages = [{ uid: 5, source: "raw" }];
    h.simpleParser.mockResolvedValue({
      messageId: "<after-reset>",
      from: { value: [{ address: "sender@example.com" }] },
      attachments: [],
    });
    await syncInboxAccount(
      makeAccount({ lastSeenUid: 500, uidValidity: null })
    );
    expect(h.simpleParser).toHaveBeenCalledWith("raw");
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSeenUid: 5,
          uidValidity: "99",
          lastSyncError: null,
        }),
      })
    );
  });
  it("builds the client from decrypted credentials", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ locked: true }]);
    h.state.mailbox = { exists: 0, uidNext: 1 };

    await syncInboxAccount(makeAccount());

    expect(h.state.lastConfig).toMatchObject({
      host: "imap.acme.test",
      port: 993,
      secure: true,
      auth: { user: "dec:enc-user", pass: "dec:enc-pass" },
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
        source: Buffer.from("raw"),
      },
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
      date: new Date("2026-02-01T10:00:00.000Z"),
    });

    await syncInboxAccount(makeAccount({ lastSeenUid: 0 }));

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        NOT: { origin: "SYSTEM" },
        messageId: {
          in: ["<orig@example.com>", "<a@x>", "<orig@example.com>"],
        },
      },
      select: { id: true },
    });

    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({
      inboxAccountId_messageId: {
        inboxAccountId: "acc-1",
        messageId: "<msg-7@example.com>",
      },
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
      imapUid: 7,
    });

    expect(prismaMock.inboxAccount.update).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: expect.objectContaining({ lastSeenUid: 10 }),
    });
    expect(h.state.closeCalls).toBe(1);
  });

  it("retains a visible body failure while importing later sparse mail", async () => {
    h.state.mailbox = { exists: 2, uidNext: 21 };
    h.state.messages = [
      { uid: 18 }, // no source -> skipped, simpleParser never called for it
      {
        uid: 19,
        internalDate: new Date("2026-03-01T00:00:00.000Z"),
        source: "raw",
      },
    ];
    h.simpleParser.mockResolvedValue({
      // no messageId, from, to, cc, references, inReplyTo, date; html not a string
      html: false,
      subject: undefined,
    });

    await syncInboxAccount(makeAccount({ lastSeenUid: 10 }));

    expect(h.simpleParser).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();

    expect(
      prismaMock.inboundMessage.upsert.mock.calls[0][0].create
    ).toMatchObject({ bodyStatus: "UNAVAILABLE", contentImportPending: true });
    const upsertArg = prismaMock.inboundMessage.upsert.mock.calls[1][0];
    expect(upsertArg.create).toMatchObject({
      messageId: "acc-1:f1:99:19", // UID-validity-scoped fallback id
      emailJobId: undefined,
      fromEmail: "unknown@example.invalid",
      fromName: undefined,
      to: [],
      cc: [],
      subject: "",
      references: [],
      html: null,
      receivedAt: new Date("2026-03-01T00:00:00.000Z"), // from internalDate
      readAt: undefined, // no \Seen flag
      imapUid: 19,
    });
  });

  it("normalizes a single-string References header", async () => {
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    h.state.mailbox = { exists: 1, uidNext: 4 };
    h.state.messages = [{ uid: 3, source: "raw" }];
    h.simpleParser.mockResolvedValue({
      references: "<solo@example.com>",
      from: { value: [{ address: "x@y.co" }] },
    });

    await syncInboxAccount(makeAccount());

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messageId: { in: ["<solo@example.com>"] },
        }),
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
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastSyncError: expect.any(String) } })
    );
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
      attachments,
    });
  }

  it("stores each attachment's blob and metadata", async () => {
    messageWithAttachments([
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        content: Buffer.from("pdf-bytes"),
        cid: "cid-1",
        contentDisposition: "attachment",
      },
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
      isInline: false,
    });
  });

  it("marks inline parts so they aren't listed as downloads", async () => {
    messageWithAttachments([
      {
        filename: "logo.png",
        contentType: "image/png",
        content: Buffer.from("png"),
        cid: "logo",
        contentDisposition: "inline",
      },
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
        content: Buffer.from("x"),
      },
    ]);

    await syncInboxAccount(makeAccount());

    const created = prismaMock.inboundAttachment.create.mock.calls[0][0];
    expect(created.data.filename).toBe("passwd");
    expect(h.storage.putObject.mock.calls[0][0].key).not.toContain("..");
  });

  it("retains oversized parts visibly without failing the sync", async () => {
    messageWithAttachments([
      {
        filename: "huge.bin",
        contentType: "application/octet-stream",
        // env default ceiling is 25MB.
        content: Buffer.alloc(26 * 1024 * 1024),
      },
    ]);

    await syncInboxAccount(makeAccount());

    expect(h.storage.putObject).not.toHaveBeenCalled();
    expect(prismaMock.inboundAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storageStatus: "TOO_LARGE" }),
      })
    );
    // The message itself is still stored and the sync still advances.
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledTimes(1);
  });

  it("keeps the message when storing a blob fails", async () => {
    messageWithAttachments([
      {
        filename: "a.txt",
        contentType: "text/plain",
        content: Buffer.from("x"),
      },
    ]);
    h.storage.putObject.mockRejectedValue(new Error("s3 down"));

    await syncInboxAccount(makeAccount());

    expect(prismaMock.inboundAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storageStatus: "UNAVAILABLE" }),
      })
    );
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { contentImportPending: true },
    });
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate attachments when the same message is re-synced", async () => {
    messageWithAttachments([
      {
        filename: "a.txt",
        contentType: "text/plain",
        content: Buffer.from("x"),
      },
    ]);
    prismaMock.inboundAttachment.findMany.mockResolvedValue([
      { id: "existing", partIndex: 0, storageStatus: "AVAILABLE" },
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
        {
          address: "mailer-daemon@mx.example.test",
          name: "Mail Delivery System",
        },
      ],
    },
    subject: "Delivery Status Notification (Failure)",
    text: [
      "Reporting-MTA: dns; mx.example.test",
      "",
      "Final-Recipient: rfc822; bob@example.com",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
      "",
    ].join("\n"),
  };

  it("flags a first-seen DSN, fails the SENT job, and suppresses the recipient", async () => {
    syncWithParsedMail(dsnMail);
    // No In-Reply-To/References and no returned original, so correlation lands
    // on the most recent SENT job to the failed address.
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "job-9",
      toEmail: "bob@example.com",
      cc: [],
      bcc: [],
      sendGroupId: null,
      organizationId: "org-1",
      origin: "MANUAL",
      status: "SENT",
      campaignRunId: null,
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
          bounceType: "HARD",
        }),
      }),
    });
    expect(prismaMock.emailJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-9", status: "SENT" },
      data: { status: "FAILED" },
    });
    expect(prismaMock.suppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          email: "bob@example.com",
          reason: "BOUNCE",
        }),
      })
    );
    // The sync itself still completes normally.
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledTimes(1);
  });

  it("re-syncing the same DSN stores the row but repeats no bounce side effects", async () => {
    syncWithParsedMail(dsnMail);
    prismaMock.inboundMessage.findUnique.mockResolvedValue({
      id: "msg-1",
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
      text: "Sounds good!",
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
    const { logger } = await import("./logger.js");

    await syncInboxAccount(makeAccount());

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "failed to process DSN"
    );
    // The message is stored and the account's cursor still advances.
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledTimes(1);
  });
});

describe("bounded history and import recovery", () => {
  it("imports recent and older sparse UIDs in bounded bodies without alerts for historical mail", async () => {
    const { notifyNewInboundMessage } = await import("./push.js");
    const { env } = await import("../config/env.js");
    const previousBatch = env.INBOX_SYNC_MAX_MESSAGES;
    env.INBOX_SYNC_MAX_MESSAGES = 200;
    const messages = Array.from({ length: 250 }, (_, index) => ({
      uid: (index + 1) * 10_000,
      source: "raw",
    }));
    h.state.messages = messages;
    h.state.mailbox = { exists: 250, uidNext: 2_500_001, uidValidity: 99n };
    h.simpleParser.mockResolvedValue({
      attachments: [],
      from: { value: [{ address: "sender@example.com" }] },
    });
    try {
      await syncInboxAccount(makeAccount());
      const first = prismaMock.inboxAccount.update.mock.calls.at(-1)![0].data;
      expect(first).toMatchObject({
        lastSeenUid: 2_500_000,
        historyBeforeUid: 1_509_999,
      });
      const initialAlerts = vi.mocked(notifyNewInboundMessage).mock.calls
        .length;
      await syncInboxAccount(
        makeAccount({
          lastSeenUid: 2_500_000,
          historyBeforeUid: 1_509_999,
          uidValidity: "99",
        })
      );
      expect(vi.mocked(notifyNewInboundMessage).mock.calls.length).toBe(
        initialAlerts
      );
      expect(
        prismaMock.inboxAccount.update.mock.calls.at(-1)![0].data
          .historyBeforeUid
      ).toBe(509_999);
      const sourceFetches = h.state.fetches.filter((fetch) => fetch.source);
      expect(sourceFetches).toHaveLength(2);
      expect(
        sourceFetches.every(
          (fetch) => Array.isArray(fetch.range) && fetch.range.length === 100
        )
      ).toBe(true);
    } finally {
      env.INBOX_SYNC_MAX_MESSAGES = previousBatch;
    }
  });

  it("retains the backfill cursor after a body import is interrupted", async () => {
    h.state.messages = [
      { uid: 50, source: "raw" },
      { uid: 60, source: "raw" },
    ];
    h.state.mailbox = { exists: 2, uidNext: 100, uidValidity: 99n };
    h.simpleParser
      .mockResolvedValueOnce({ attachments: [] })
      .mockRejectedValueOnce(new Error("Interrupted source"));
    await expect(
      syncInboxAccount(
        makeAccount({
          lastSeenUid: 99,
          uidValidity: "99",
          historyBeforeUid: 80,
        })
      )
    ).rejects.toThrow("Interrupted source");
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboxAccount.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ historyBeforeUid: expect.any(Number) }),
      })
    );
  });

  it("stops after the import deadline before storing a slowly parsed message", async () => {
    const base = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(base);
    h.state.messages = [{ uid: 5, source: "raw" }];
    h.state.mailbox = { exists: 1, uidNext: 6 };
    h.simpleParser.mockImplementation(async () => {
      now.mockReturnValue(base + 250_000);
      return { attachments: [] };
    });
    try {
      await expect(syncInboxAccount(makeAccount())).rejects.toThrow(
        "time limit"
      );
      expect(prismaMock.inboundMessage.upsert).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it("recovers a failed part with the same row and storage key", async () => {
    const mail = {
      attachments: [
        {
          filename: "file.txt",
          contentType: "text/plain",
          content: Buffer.from("data"),
        },
      ],
    } as never;
    h.storage.putObject.mockRejectedValueOnce(new Error("Storage unavailable"));
    await storeAttachments({
      organizationId: "org-1",
      inboundMessageId: "msg-1",
      mail,
    });
    const row = {
      id: "part-1",
      ...prismaMock.inboundAttachment.create.mock.calls[0][0].data,
    };
    prismaMock.inboundAttachment.findMany.mockResolvedValue([row] as never);
    await storeAttachments({
      organizationId: "org-1",
      inboundMessageId: "msg-1",
      mail,
    });
    expect(prismaMock.inboundAttachment.create).toHaveBeenCalledTimes(1);
    expect(h.storage.putObject.mock.calls[0][0].key).toBe(
      h.storage.putObject.mock.calls[1][0].key
    );
    expect(prismaMock.inboundAttachment.update).toHaveBeenCalledWith({
      where: { id: "part-1" },
      data: { storageStatus: "AVAILABLE", storageError: null },
    });
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenLastCalledWith({
      where: { id: "msg-1" },
      data: { contentImportPending: false },
    });
  });
});

describe("durable MIME recovery", () => {
  it("restores a missing body without resetting a teammate's read state", async () => {
    h.state.mailbox = { exists: 1, uidNext: 6, uidValidity: 99n };
    h.state.messages = [
      { uid: 5, source: "restored", envelope: { messageId: "<m@mail>" } },
    ];
    prismaMock.inboundMessageLocation.findMany.mockResolvedValue([
      {
        uid: 5,
        uidValidity: "99",
        message: {
          id: "msg-1",
          messageId: "<m@mail>",
          bodyStatus: "UNAVAILABLE",
        },
      },
    ] as never);
    prismaMock.inboundMessage.findUnique.mockResolvedValue({
      id: "msg-1",
      bodyStatus: "UNAVAILABLE",
    } as never);
    h.simpleParser.mockResolvedValue({
      messageId: "<m@mail>",
      html: "<p>Recovered body</p>",
      attachments: [],
    });
    await syncInboxAccount(
      makeAccount({ lastSeenUid: 5, historyBeforeUid: 0, uidValidity: "99" })
    );
    const update = prismaMock.inboundMessage.upsert.mock.calls[0][0].update;
    expect(update).toMatchObject({
      html: "<p>Recovered body</p>",
      bodyStatus: "AVAILABLE",
      bodyError: null,
    });
    expect(update).not.toHaveProperty("readAt");
    expect(update).not.toHaveProperty("readRevision");
  });
  it("does not recover content from a reused UID belonging to another message", async () => {
    h.state.mailbox = { exists: 1, uidNext: 6, uidValidity: 99n };
    h.state.messages = [
      {
        uid: 5,
        source: "wrong body",
        envelope: { messageId: "<different@mail>" },
      },
    ];
    prismaMock.inboundMessageLocation.findMany.mockResolvedValue([
      {
        uid: 5,
        uidValidity: "99",
        message: {
          id: "msg-1",
          messageId: "<m@mail>",
          bodyStatus: "UNAVAILABLE",
        },
      },
    ] as never);
    await syncInboxAccount(
      makeAccount({ lastSeenUid: 5, historyBeforeUid: 0, uidValidity: "99" })
    );
    expect(h.simpleParser).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessage.upsert).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { contentAttemptedAt: expect.any(Date) },
    });
  });
  it("adopts a matching legacy file while still importing a previously missing second part", async () => {
    const file = {
      filename: "good.txt",
      contentType: "text/plain",
      content: Buffer.from("good"),
    };
    prismaMock.inboundAttachment.findMany.mockResolvedValue([
      {
        id: "legacy",
        partIndex: null,
        storageStatus: "AVAILABLE",
        filename: "good.txt",
        contentType: "text/plain",
        size: 4,
        contentId: null,
      },
    ] as never);
    await storeAttachments({
      organizationId: "org-1",
      inboundMessageId: "msg-1",
      mail: {
        attachments: [file, { ...file, filename: "missing.txt" }],
      } as never,
    });
    expect(prismaMock.inboundAttachment.update).toHaveBeenCalledWith({
      where: { id: "legacy" },
      data: { partIndex: 0 },
    });
    expect(prismaMock.inboundAttachment.create).toHaveBeenCalledTimes(1);
    expect(h.storage.putObject).toHaveBeenCalledTimes(1);
    expect(h.storage.putObject.mock.calls[0][0].key).toContain("1-missing.txt");
  });
});

describe("independent folder imports", () => {
  it("keeps identical numeric UIDs in different folder namespaces", async () => {
    const account = makeAccount();
    h.state.paths = ["INBOX", "Sent"];
    h.state.byFolder = {
      INBOX: {
        exists: 1,
        uidNext: 8,
        uidValidity: 99n,
        messages: [{ uid: 7, source: "received" }],
      },
      Sent: {
        exists: 1,
        uidNext: 8,
        uidValidity: 101n,
        messages: [{ uid: 7, source: "sent" }],
      },
    };
    prismaMock.inboxFolder.findMany.mockResolvedValue([
      { id: "f1", path: "INBOX", role: "INBOX", lastSeenUid: 0 },
      { id: "f2", path: "Sent", role: "SENT", lastSeenUid: 0 },
    ] as never);
    h.simpleParser.mockImplementation(async (raw) => ({
      messageId: `<${raw}@mail>`,
      attachments: [],
    }));
    await syncInboxAccount(account);
    expect(prismaMock.inboundMessageLocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          inboxFolderId_uidValidity_uid: {
            inboxFolderId: "f1",
            uidValidity: "99",
            uid: 7,
          },
        },
      })
    );
    expect(prismaMock.inboundMessageLocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          inboxFolderId_uidValidity_uid: {
            inboxFolderId: "f2",
            uidValidity: "101",
            uid: 7,
          },
        },
      })
    );
    expect(prismaMock.inboxFolder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "f2" },
        data: expect.objectContaining({ lastSeenUid: 7, uidValidity: "101" }),
      })
    );
  });
  it("does not expose QQueue system sends through external Sent import", async () => {
    const account = makeAccount({ mailbox: "Sent" });
    h.state.paths = ["Sent"];
    prismaMock.inboxFolder.findMany.mockResolvedValue([
      { id: "f1", path: "Sent", role: "SENT", lastSeenUid: 0 },
    ] as never);
    h.state.mailbox = { exists: 1, uidNext: 8, uidValidity: 99n };
    h.state.messages = [{ uid: 7, source: "system" }];
    h.simpleParser.mockResolvedValue({ messageId: "<system@mail>" });
    prismaMock.emailJob.findFirst.mockResolvedValue({
      id: "system_job",
    } as never);
    await syncInboxAccount(account);
    expect(prismaMock.inboundMessage.upsert).not.toHaveBeenCalled();
  });
  it("continues the rotating secondary folder after the primary import fails", async () => {
    const account = makeAccount();
    h.state.paths = ["INBOX", "Archive"];
    h.state.byFolder = {
      INBOX: {
        exists: 1,
        uidNext: 8,
        uidValidity: 99n,
        messages: [{ uid: 7, source: "failed" }],
      },
      Archive: {
        exists: 1,
        uidNext: 9,
        uidValidity: 101n,
        messages: [{ uid: 8, source: "archive" }],
      },
    };
    prismaMock.inboxFolder.findMany.mockResolvedValue([
      { id: "f1", path: "INBOX", role: "INBOX", lastSeenUid: 0 },
      { id: "f2", path: "Archive", role: "ARCHIVE", lastSeenUid: 0 },
    ] as never);
    h.simpleParser
      .mockRejectedValueOnce(new Error("bad primary body"))
      .mockResolvedValue({ messageId: "<old@mail>", attachments: [] });
    await expect(syncInboxAccount(account)).rejects.toThrow("bad primary body");
    expect(prismaMock.inboxFolder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "f2" },
        data: expect.objectContaining({ lastSeenUid: 8 }),
      })
    );
  });
  it("preserves cached mail when the configured folder disappears", async () => {
    const account = makeAccount();
    h.state.paths = [];
    prismaMock.inboxFolder.findMany.mockResolvedValue([]);
    await syncInboxAccount(account);
    expect(prismaMock.inboxAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          lastSyncError: expect.stringContaining(
            "cached messages are retained"
          ),
        },
      })
    );
    expect(prismaMock.inboundMessage.deleteMany).not.toHaveBeenCalled();
  });
});

describe("versioned imported mailbox drafts", () => {
  function draftFolder() {
    const account = makeAccount({ mailbox: "Drafts" });
    h.state.paths = ["Drafts"];
    h.state.mailbox = { exists: 1, uidNext: 8, uidValidity: 99n };
    h.state.messages = [{ uid: 7, source: "new draft source" }];
    prismaMock.inboxFolder.findMany.mockResolvedValue([
      { id: "f1", path: "Drafts", role: "DRAFTS", lastSeenUid: 0 },
    ] as never);
    h.simpleParser.mockResolvedValue({
      messageId: "<external-draft>",
      html: "<p>New writing</p>",
      bcc: { value: [{ address: "hidden@example.test" }] },
      attachments: [],
    });
    return account;
  }
  it("imports Bcc and exact source identity without treating a new draft as received mail", async () => {
    const account = draftFolder();
    await syncInboxAccount(account);
    expect(h.simpleParser).toHaveBeenCalledWith("new draft source", {
      keepCidLinks: true,
    });
    const hash = createHash("sha256").update("new draft source").digest("hex");
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          remoteDraftVersion: hash,
          remoteDraftFolderId: "f1",
          remoteDraftUid: 7,
          remoteDraftUidValidity: "99",
          remoteDraftBcc: ["hidden@example.test"],
        }),
      })
    );
    expect(prismaMock.inboundMessageLocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ contentHash: hash }),
      })
    );
  });
  it("clears removed rich text and reply headers rather than retaining a previous draft version", async () => {
    const account = draftFolder();
    h.simpleParser.mockResolvedValue({
      messageId: "<external-draft>",
      text: "Plain replacement",
      html: false,
      attachments: [],
    });
    await syncInboxAccount(account);
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          html: null,
          text: "Plain replacement",
          inReplyTo: null,
          remoteDraftBcc: [],
        }),
      })
    );
  });
  it("keeps a draft’s current writing when a non-draft copy shares its Message-ID", async () => {
    const account = makeAccount();
    h.state.mailbox = { exists: 1, uidNext: 8, uidValidity: 99n };
    h.state.messages = [{ uid: 7, source: "older non-draft source" }];
    h.simpleParser.mockResolvedValue({
      messageId: "<external-draft>",
      html: "<p>Old writing</p>",
      attachments: [],
    });
    prismaMock.inboundMessage.findUnique.mockResolvedValue({
      id: "msg-1",
      remoteDraftVersion: "newest",
      remoteDraftFolderId: "draft-folder",
      remoteDraftUid: 8,
      remoteDraftUidValidity: "99",
      readAt: null,
      readRevision: 1,
      flagged: false,
      flagRevision: 1,
    } as never);
    prismaMock.inboundMessageLocation.findFirst.mockResolvedValue({
      id: "present-draft",
    } as never);
    await syncInboxAccount(account);
    expect(prismaMock.inboundMessage.upsert).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessageLocation.upsert).toHaveBeenCalled();
  });
  it("does not replace a newer draft with a backfilled lower UID in the same namespace", async () => {
    const account = draftFolder();
    prismaMock.inboundMessage.findUnique.mockResolvedValue({
      id: "msg-1",
      remoteDraftVersion: "newest",
      remoteDraftFolderId: "f1",
      remoteDraftUid: 8,
      remoteDraftUidValidity: "99",
      readAt: null,
      readRevision: 1,
      flagged: false,
      flagRevision: 1,
    } as never);
    await syncInboxAccount(account);
    expect(prismaMock.inboundMessage.upsert).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessageLocation.upsert).toHaveBeenCalled();
  });
  it("accepts a new UID-validity namespace even when its numeric UID is lower", async () => {
    const account = draftFolder();
    prismaMock.inboundMessage.findUnique.mockResolvedValue({
      id: "msg-1",
      remoteDraftVersion: "previous-namespace",
      remoteDraftFolderId: "f1",
      remoteDraftUid: 800,
      remoteDraftUidValidity: "98",
      readAt: null,
      readRevision: 1,
      flagged: false,
      flagRevision: 1,
    } as never);
    await syncInboxAccount(account);
    expect(prismaMock.inboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          html: "<p>New writing</p>",
          remoteDraftUid: 7,
          remoteDraftUidValidity: "99",
        }),
      })
    );
  });
  it("stores changed draft file bytes under a new immutable key and replaces obsolete current metadata", async () => {
    prismaMock.inboundAttachment.findMany.mockResolvedValue([
      {
        id: "old-file",
        partIndex: 0,
        storageStatus: "AVAILABLE",
        storageKey: "old-private-key",
        contentHash: "old-hash",
        filename: "old.txt",
        contentType: "text/plain",
        size: 3,
        contentId: null,
        isInline: false,
      },
    ] as never);
    await storeAttachments({
      organizationId: "org-1",
      inboundMessageId: "msg-1",
      replaceDraftParts: true,
      mail: {
        attachments: [
          {
            filename: "new.txt",
            contentType: "text/plain",
            content: Buffer.from("new bytes"),
            contentDisposition: "attachment",
          },
        ],
      } as never,
    });
    const key = h.storage.putObject.mock.calls[0][0].key;
    expect(key).not.toBe("old-private-key");
    expect(key).toContain(
      createHash("sha256").update("new bytes").digest("hex")
    );
    expect(prismaMock.inboundAttachment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "old-file" },
        data: expect.objectContaining({
          filename: "new.txt",
          size: 9,
          storageKey: key,
        }),
      })
    );
    expect(prismaMock.inboundAttachment.deleteMany).toHaveBeenCalledWith({
      where: {
        inboundMessageId: "msg-1",
        OR: [{ partIndex: { notIn: [0] } }, { partIndex: null }],
      },
    });
  });
});
