import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { inboxService } from "./service.js";
import { manualEmailService } from "../manual-email/service.js";
import { inboundMessageQuerySchema } from "@qqueue/shared";
import { inboxSyncQueue } from "../../queues/inbox-sync.queue.js";
import { sentService } from "../sent/service.js";
import { outboxService } from "../outbox/service.js";
import { sentEmailQuerySchema } from "@qqueue/shared";

vi.mock("../../lib/storage.js", () => ({ storage: { getObject: vi.fn() } }));

const message = {
  id: "received",
  organizationId: "org_1",
  inboxAccountId: "inbox_1",
  messageId: "<received>",
  references: ["<root>"],
  inReplyTo: "<root>",
  fromEmail: "sender@example.com",
  replyTo: ["answers@example.com"],
  to: ["support@example.com", "other@example.com"],
  cc: ["copy@example.com"],
  subject: "Question",
  receivedAt: new Date(),
  readAt: null,
  isDsn: false,
  inboxAccount: { email: "support@example.com" },
};

beforeEach(() => {
  vi.restoreAllMocks();
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "MEMBER",
  } as never);
  prismaMock.inboxAccountGrant.findMany.mockResolvedValue([
    { inboxAccountId: "inbox_1" },
  ] as never);
  prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
    { smtpConnectionId: "smtp_support" },
  ] as never);
  manualEmailService.clearRecipientSuggestionCache();
});

describe("organization mail privacy", () => {
  it("keeps reset and invitation jobs out of Sent, including owners' direct reads", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER",
    } as never);
    prismaMock.emailJob.findMany.mockResolvedValue([]);
    prismaMock.emailJob.count.mockResolvedValue(0);
    await sentService.list(
      sentEmailQuerySchema.parse({ organizationId: "org_1", origin: "SYSTEM" }),
      "user_1"
    );
    expect(prismaMock.emailJob.findMany.mock.calls[0][0]?.where).toMatchObject({
      NOT: { origin: "SYSTEM" },
    });
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    await expect(
      sentService.get("reset_job", "org_1", "user_1")
    ).rejects.toThrow("Email not found");
    expect(prismaMock.emailJob.findFirst.mock.calls[0][0]?.where).toMatchObject(
      { NOT: { origin: "SYSTEM" } }
    );
    await outboxService.list("org_1", "user_1");
    expect(prismaMock.emailJob.findMany.mock.calls[1][0]?.where).toMatchObject({
      NOT: { origin: "SYSTEM" },
    });
  });

  it("scopes autocomplete and delivery status to granted mailboxes and personal sends", async () => {
    prismaMock.emailJob.findMany.mockResolvedValue([]);
    await manualEmailService.recentRecipients("org_1", "user_1");
    expect(prismaMock.emailJob.findMany.mock.calls[0][0]?.where).toMatchObject({
      NOT: { origin: "SYSTEM" },
      OR: [
        { smtpConnectionId: { in: ["smtp_support"] } },
        { createdByUserId: "user_1" },
      ],
    });
    prismaMock.emailJob.findFirst.mockResolvedValue(null);
    await expect(
      manualEmailService.deliveryStatus("private_job", "org_1", "user_1")
    ).rejects.toThrow("Email not found");
    expect(prismaMock.emailJob.findFirst.mock.calls[0][0]?.where).toMatchObject(
      {
        OR: [
          { smtpConnectionId: { in: ["smtp_support"] } },
          { createdByUserId: "user_1" },
        ],
        NOT: { origin: "SYSTEM" },
      }
    );
  });

  it("does not retain suggestions after mailbox access is revoked", async () => {
    prismaMock.emailJob.findMany
      .mockResolvedValueOnce([
        { toEmail: "private@example.com", cc: [], bcc: [] },
      ] as never)
      .mockResolvedValueOnce([]);
    expect(
      await manualEmailService.recentRecipients("org_1", "user_1")
    ).toHaveLength(1);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
    expect(
      await manualEmailService.recentRecipients("org_1", "user_1")
    ).toEqual([]);
    expect(prismaMock.emailJob.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("safe mailbox operations", () => {
  it("disconnects by disabling sync and preserves all messages", async () => {
    prismaMock.inboxAccount.updateMany.mockResolvedValue({ count: 1 });
    await inboxService.deleteAccount("inbox_1", "user_1", "org_1");
    expect(prismaMock.inboxAccount.updateMany).toHaveBeenCalledWith({
      where: {
        id: "inbox_1",
        organizationId: "org_1",
        organization: {
          members: {
            some: { userId: "user_1", role: { in: ["OWNER", "ADMIN"] } },
          },
        },
      },
      data: { status: "DISABLED" },
    });
    expect(prismaMock.inboxAccount.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects an account outside the verified organization or administrative role", async () => {
    prismaMock.inboxAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      inboxService.updateAccount(
        "other_inbox",
        "user_1",
        { name: "Changed" },
        "org_1"
      )
    ).rejects.toThrow("Inbox account not found");
    expect(
      prismaMock.inboxAccount.updateMany.mock.calls[0][0]?.where
    ).toMatchObject({
      organizationId: "org_1",
      organization: { members: { some: { role: { in: ["OWNER", "ADMIN"] } } } },
    });
  });

  it("bulk read intersects supplied IDs with mailbox grants", async () => {
    prismaMock.inboundMessage.updateMany.mockResolvedValue({ count: 1 });
    expect(
      await inboxService.markManyRead(
        "org_1",
        "user_1",
        ["received", "private"],
        true
      )
    ).toEqual({ updated: 1 });
    expect(
      prismaMock.inboundMessage.updateMany.mock.calls[0][0]?.where
    ).toMatchObject({
      organizationId: "org_1",
      id: { in: ["received", "private"] },
      inboxAccountId: { in: ["inbox_1"] },
    });
  });

  it("syncs only active mailboxes the caller can read", async () => {
    prismaMock.inboxAccount.findMany.mockResolvedValue([
      { id: "inbox_1" },
    ] as never);
    await inboxService.requestSync("org_1", "user_1", "inbox_1");
    expect(
      prismaMock.inboxAccount.findMany.mock.calls[0][0]?.where
    ).toMatchObject({
      status: "ACTIVE",
      id: { in: ["inbox_1"] },
      AND: [{ id: "inbox_1" }],
    });
    expect(inboxSyncQueue.add).toHaveBeenCalledWith(
      "sync-inbox",
      { inboxAccountId: "inbox_1" },
      expect.objectContaining({
        jobId: expect.stringMatching(/^inbox-sync-inbox_1-/),
      })
    );
    await inboxService.requestSync("org_1", "user_1", "inbox_1");
    expect(inboxSyncQueue.add.mock.calls[0][2]?.jobId).not.toBe(
      inboxSyncQueue.add.mock.calls[1][2]?.jobId
    );
  });
});

describe("complete conversations and correct replies", () => {
  it("uses the last displayed message as the cursor without skipping the next message", async () => {
    prismaMock.inboundMessage.findMany.mockResolvedValue([
      { ...message, id: "first" },
      { ...message, id: "second" },
      { ...message, id: "third" },
    ] as never);
    const result = await inboxService.listMessages(
      inboundMessageQuerySchema.parse({
        organizationId: "org_1",
        inboxAccountId: "inbox_1",
        limit: 2,
      }),
      "user_1"
    );
    expect(result.data.map((item) => item.id)).toEqual(["first", "second"]);
    expect(result.nextCursor).toBe("second");
    expect(
      prismaMock.inboundMessage.findMany.mock.calls[0][0]?.where
    ).toMatchObject({ inboxAccountId: { in: ["inbox_1"] } });
  });

  it("retrieves older messages independently of search, read filter and list page", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue(message as never);
    prismaMock.inboundMessage.findMany.mockResolvedValue([
      {
        ...message,
        id: "root",
        messageId: "<root>",
        references: [],
        inReplyTo: null,
      },
      message,
    ] as never);
    prismaMock.emailJob.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
    const result = await inboxService.getConversation(
      "received",
      "org_1",
      "user_1"
    );
    expect(result.messages).toHaveLength(2);
    expect(
      prismaMock.inboundMessage.findMany.mock.calls[0][0]?.where
    ).toMatchObject({ organizationId: "org_1", inboxAccountId: "inbox_1" });
    expect(prismaMock.emailJob.findMany.mock.calls[0][0]?.where).toMatchObject({
      NOT: { origin: "SYSTEM" },
    });
  });

  it("respects Reply-To and sends attachments through the matching authorized account", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue(message as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({
      id: "smtp_support",
      fromEmail: "support@example.com",
    } as never);
    const send = vi
      .spyOn(manualEmailService, "send")
      .mockResolvedValue({ id: "reply", status: "QUEUED" });
    await inboxService.replyToMessage("received", "user_1", {
      organizationId: "org_1",
      subject: "Question",
      html: "<p>Hello</p>",
      attachmentIds: ["file_1"],
      replyAll: true,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        smtpConnectionId: "smtp_support",
        to: ["answers@example.com", "other@example.com"],
        cc: ["copy@example.com"],
        attachmentIds: ["file_1"],
        inReplyTo: "<received>",
      }),
      "user_1"
    );
    expect(
      prismaMock.sMTPConnection.findFirst.mock.calls[0][0]?.where
    ).toMatchObject({
      fromEmail: { equals: "support@example.com", mode: "insensitive" },
      id: { in: ["smtp_support"] },
    });
  });

  it("never falls back to an unrelated default sending account", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue(message as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    const send = vi.spyOn(manualEmailService, "send");
    await expect(
      inboxService.replyToMessage("received", "user_1", {
        organizationId: "org_1",
        subject: "Question",
        text: "Hello",
      })
    ).rejects.toThrow("This mailbox has no sending account you can use");
    expect(send).not.toHaveBeenCalled();
  });
});

it("includes an authorized completed reply to a headerless original without inventing RFC headers", async () => {
  prismaMock.inboundMessage.findFirst.mockResolvedValue({
    ...message,
    messageId: "imap:a:77:1",
    references: [],
    inReplyTo: null,
  } as never);
  prismaMock.inboundMessage.findMany.mockResolvedValue([]);
  prismaMock.emailDraft.findMany.mockResolvedValue([
    { completedSendId: "accepted_reply" },
  ] as never);
  prismaMock.emailJob.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  await inboxService.getConversation("received", "org_1", "user_1");
  expect(prismaMock.emailDraft.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        organizationId: "org_1",
        inboundMessageId: { in: ["received"] },
        completedSendId: { not: null },
      },
    })
  );
  expect(prismaMock.emailJob.findMany.mock.calls[0][0]?.where).toMatchObject({
    NOT: { origin: "SYSTEM" },
    AND: [
      expect.anything(),
      { OR: expect.arrayContaining([{ id: { in: ["accepted_reply"] } }]) },
    ],
  });
});

it("keeps complete conversation membership while fetching at most ten received/sent bodies per stable page", async () => {
  const rows = Array.from({ length: 35 }, (_, index) => ({
    ...message,
    id: `received-${index}`,
    messageId: `<received-${index}>`,
    html: `<p>Body ${index}</p>`,
    text: `Body ${index}`,
    receivedAt: new Date(2026, 0, 1, 0, index),
    attachments: [{ id: `file-${index}`, filename: `file-${index}.txt` }],
  }));
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    id: `sent-${index}`,
    messageId: `<sent-${index}>`,
    subject: "Reply",
    html: `<p>Sent ${index}</p>`,
    text: `Sent ${index}`,
    sentAt: new Date(2026, 0, 1, 0, 30, index),
    createdAt: new Date(2026, 0, 1, 0, 30, index),
    attachments: [],
    smtpConnection: null,
    status: "SENT",
    groupStatus: null,
    visibleTo: [],
    visibleCc: [],
    cc: [],
  }));
  prismaMock.inboundMessage.findFirst.mockResolvedValue(rows.at(-1) as never);
  prismaMock.inboundMessage.findMany.mockImplementation((async (args: {
    omit?: unknown;
    where: { id?: { in: string[] } };
  }) =>
    args.omit
      ? rows.map(
          ({ html: _html, text: _text, attachments: _files, ...metadata }) =>
            metadata
        )
      : rows.filter((row) => args.where.id!.in.includes(row.id))) as never);
  prismaMock.emailJob.findMany.mockImplementation((async (args: {
    select: { html?: boolean };
    where: { id?: { in: string[] } };
  }) =>
    args.select.html
      ? jobs.filter((job) => args.where.id!.in.includes(job.id))
      : jobs.map(
          ({ html: _html, text: _text, attachments: _files, ...metadata }) =>
            metadata
        )) as never);
  prismaMock.user.findMany.mockResolvedValue([]);
  let before: string | undefined;
  const seen: string[] = [];
  for (let page = 0; page < 5; page++) {
    const result = await inboxService.getConversation(
      "received-34",
      "org_1",
      "user_1",
      { paged: "true", before }
    );
    expect(result.messages).toHaveLength(35);
    expect(result.window.keys.length).toBeLessThanOrEqual(10);
    expect(
      result.messages.filter((row) => row.bodyLoaded).length +
        result.outgoing.filter((row) => row.html).length
    ).toBeLessThanOrEqual(10);
    for (const row of result.messages.filter((row) => !row.bodyLoaded))
      expect(row).toMatchObject({ html: null, text: null, attachments: [] });
    seen.unshift(...result.window.keys);
    if (!result.window.before) break;
    before = result.window.before;
  }
  expect(seen).toHaveLength(45);
  expect(new Set(seen).size).toBe(45);
  expect(prismaMock.inboundMessage.findFirst.mock.calls[0][0]).toMatchObject({
    omit: { html: true, text: true },
    where: { inboxAccountId: { in: ["inbox_1"] } },
  });
  const bodyReads = prismaMock.inboundMessage.findMany.mock.calls.filter(
    ([args]) => !args?.omit
  );
  expect(
    bodyReads.every(
      ([args]) => (args?.where?.id as { in: string[] }).in.length <= 10
    )
  ).toBe(true);
  const legacy = await inboxService.getConversation(
    "received-34",
    "org_1",
    "user_1",
    {}
  );
  expect(legacy.messages.filter((row) => row.bodyLoaded)).toHaveLength(35);
  expect(legacy.outgoing.filter((row) => row.html)).toHaveLength(10);
});
