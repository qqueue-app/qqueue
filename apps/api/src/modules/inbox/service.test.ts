import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { inboxService } from "./service.js";

const imapMock = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  mailboxOpen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
}));

const manualEmailServiceMock = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ id: "job_reply", status: "QUEUED" }),
}));

const storageMock = vi.hoisted(() => ({
  getObject: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("../../lib/storage.js", () => ({ storage: storageMock }));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(() => imapMock),
}));

vi.mock("../manual-email/service.js", () => ({
  manualEmailService: manualEmailServiceMock,
}));

// OWNER unless a case says otherwise: an owner reads every mailbox in the org,
// so the scope drops out and these cases keep asserting the query they always
// asserted. The MEMBER path has its own describe block below.
beforeEach(() => {
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
});

describe("inboxService", () => {
  it("lists inbox accounts without returning encrypted secrets", async () => {
    prismaMock.inboxAccount.findMany.mockResolvedValue([] as never);

    await inboxService.listAccounts("org_1", "user_1");

    expect(prismaMock.inboxAccount.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      select: expect.not.objectContaining({
        usernameEncrypted: true,
        passwordEncrypted: true,
      }),
      orderBy: { createdAt: "desc" },
    });
  });

  it("creates an inbox account with encrypted credentials", async () => {
    prismaMock.inboxAccount.create.mockResolvedValue({ id: "acct_1" } as never);

    await inboxService.createAccount({
      organizationId: "org_1",
      name: "Support inbox",
      email: "support@example.com",
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "support@example.com",
      password: "secret",
      mailbox: "INBOX",
    });

    expect(imapMock.connect).toHaveBeenCalled();
    expect(imapMock.mailboxOpen).toHaveBeenCalledWith("INBOX", {
      readOnly: true,
    });
    const call = prismaMock.inboxAccount.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      organizationId: "org_1",
      email: "support@example.com",
      host: "imap.example.com",
      mailbox: "INBOX",
    });
    expect(call.data.usernameEncrypted).not.toBe("support@example.com");
    expect(call.data.passwordEncrypted).not.toBe("secret");
  });

  it("stores inbound messages idempotently and anchors replies to outbound jobs", async () => {
    prismaMock.inboxAccount.findFirst.mockResolvedValue({
      id: "acct_1",
    } as never);
    prismaMock.emailJob.findFirst.mockResolvedValue({ id: "job_1" } as never);
    prismaMock.inboundMessage.upsert.mockResolvedValue({
      id: "msg_1",
    } as never);

    await inboxService.storeInboundMessage({
      organizationId: "org_1",
      inboxAccountId: "acct_1",
      messageId: "<reply@example.com>",
      inReplyTo: "<sent@example.com>",
      references: ["<root@example.com>"],
      fromEmail: "person@example.com",
      to: ["support@example.com"],
      cc: [],
      subject: "Re: Hello",
      receivedAt: "2026-06-17T10:00:00.000Z",
    });

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        messageId: { in: ["<sent@example.com>", "<root@example.com>"] },
      },
      select: { id: true },
    });
    const call = prismaMock.inboundMessage.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      inboxAccountId_messageId: {
        inboxAccountId: "acct_1",
        messageId: "<reply@example.com>",
      },
    });
    expect(call.create).toMatchObject({
      organizationId: "org_1",
      emailJobId: "job_1",
      fromEmail: "person@example.com",
    });
  });

  it("rejects storing a message for an account outside the organization", async () => {
    prismaMock.inboxAccount.findFirst.mockResolvedValue(null);

    await expect(
      inboxService.storeInboundMessage({
        organizationId: "org_1",
        inboxAccountId: "acct_1",
        messageId: "<reply@example.com>",
        references: [],
        fromEmail: "person@example.com",
        to: [],
        cc: [],
        subject: "Hi",
        receivedAt: "2026-06-17T10:00:00.000Z",
      })
    ).rejects.toThrow("Inbox account not found");
  });

  it("lists messages with search and unread filters", async () => {
    prismaMock.inboundMessage.findMany.mockResolvedValue([] as never);

    await inboxService.listMessages(
      {
        organizationId: "org_1",
        q: "invoice",
        read: "unread",
        limit: 25,
      },
      "user_1"
    );

    const call = prismaMock.inboundMessage.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      organizationId: "org_1",
      readAt: null,
      OR: [
        { subject: { contains: "invoice", mode: "insensitive" } },
        { fromEmail: { contains: "invoice", mode: "insensitive" } },
        { fromName: { contains: "invoice", mode: "insensitive" } },
        { text: { contains: "invoice", mode: "insensitive" } },
      ],
    });
    expect(call.take).toBe(26);
  });

  it("replies to inbound messages through the manual send pipeline", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue({
      id: "msg_1",
      organizationId: "org_1",
      messageId: "<reply@example.com>",
      inReplyTo: "<sent@example.com>",
      references: ["<root@example.com>", "<sent@example.com>"],
      fromEmail: "customer@example.com",
      subject: "Question",
      readAt: null,
      inboxAccount: { email: "support@example.com" },
    } as never);
    prismaMock.inboundMessage.update.mockResolvedValue({
      id: "msg_1",
    } as never);

    await inboxService.replyToMessage("msg_1", "user_1", {
      organizationId: "org_1",
      subject: "Question",
      text: "Thanks for reaching out.",
    });

    expect(manualEmailServiceMock.send).toHaveBeenCalledWith(
      {
        organizationId: "org_1",
        to: ["customer@example.com"],
        replyTo: "support@example.com",
        smtpConnectionId: undefined,
        subject: "Re: Question",
        html: undefined,
        text: "Thanks for reaching out.",
        inReplyTo: "<reply@example.com>",
        references: [
          "<root@example.com>",
          "<sent@example.com>",
          "<reply@example.com>",
        ],
      },
      "user_1"
    );
  });

  it("marks a message read scoped to the reader's mailboxes", async () => {
    prismaMock.inboundMessage.updateMany.mockResolvedValue({
      count: 1,
    } as never);
    prismaMock.inboundMessage.findUniqueOrThrow.mockResolvedValue({
      id: "msg_1",
    } as never);

    await inboxService.markRead("msg_1", "user_1", "org_1", true);

    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "msg_1", organizationId: "org_1" },
      data: { readAt: expect.any(Date) },
    });
  });
});

describe("inboxService.downloadAttachment", () => {
  it("scopes the lookup to the mailboxes the caller can read", async () => {
    prismaMock.inboundAttachment.findFirst.mockResolvedValue({
      id: "att_1",
      filename: "report.pdf",
      contentType: "application/pdf",
      storageKey: "inbound/org_1/abc-report.pdf",
    } as never);
    storageMock.getObject.mockResolvedValue(Buffer.from("pdf-bytes"));

    const result = await inboxService.downloadAttachment(
      "att_1",
      "user_1",
      "org_1"
    );

    // Scoped through the parent message, not by an uploading user: nobody here
    // authored the file, it arrived in a mailbox — so it is exactly as private
    // as the mail it came on. An owner reads every mailbox, hence the empty
    // relation filter.
    expect(prismaMock.inboundAttachment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "att_1",
        organizationId: "org_1",
        inboundMessage: {},
      },
    });
    expect(storageMock.getObject).toHaveBeenCalledWith(
      "inbound/org_1/abc-report.pdf"
    );
    expect(result.body).toEqual(Buffer.from("pdf-bytes"));
    expect(result.attachment.filename).toBe("report.pdf");
  });

  it("404s for an attachment outside the caller's organizations", async () => {
    storageMock.getObject.mockClear();
    prismaMock.inboundAttachment.findFirst.mockResolvedValue(null as never);

    await expect(
      inboxService.downloadAttachment("att_1", "user_1", "org_1")
    ).rejects.toThrow("Attachment not found");
    // The blob is never fetched for an attachment the caller can't see.
    expect(storageMock.getObject).not.toHaveBeenCalled();
  });
});

describe("inboxService mailbox scope", () => {
  beforeEach(() => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([
      { inboxAccountId: "inbox_1" },
    ] as never);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([] as never);
    manualEmailServiceMock.send.mockClear();
  });

  it("lists a MEMBER only the mailboxes they were given", async () => {
    prismaMock.inboxAccount.findMany.mockResolvedValue([] as never);

    await inboxService.listAccounts("org_1", "user_1");

    const call = prismaMock.inboxAccount.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      organizationId: "org_1",
      id: { in: ["inbox_1"] },
    });
  });

  it("lists a MEMBER only messages from those mailboxes", async () => {
    prismaMock.inboundMessage.findMany.mockResolvedValue([] as never);

    await inboxService.listMessages(
      { organizationId: "org_1", read: "all", limit: 25 },
      "user_1"
    );

    const call = prismaMock.inboundMessage.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      organizationId: "org_1",
      inboxAccountId: { in: ["inbox_1"] },
    });
  });

  it("counts unread against the same mailboxes it lists", async () => {
    // A badge counting mail the reader cannot open is one they can never clear.
    prismaMock.inboundMessage.count.mockResolvedValue(3 as never);

    await inboxService.unreadCount("org_1", "user_1");

    const call = prismaMock.inboundMessage.count.mock.calls[0][0];
    expect(call.where).toMatchObject({
      organizationId: "org_1",
      readAt: null,
      isDsn: false,
      inboxAccountId: { in: ["inbox_1"] },
    });
  });

  it("gives a member with no mailboxes an empty inbox, not the org's", async () => {
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([] as never);
    prismaMock.inboundMessage.findMany.mockResolvedValue([] as never);

    await inboxService.listMessages(
      { organizationId: "org_1", read: "all", limit: 25 },
      "user_1"
    );

    // `{ in: [] }` matches nothing, which is the point: an unscoped `where`
    // would hand them every message in the organization.
    const call = prismaMock.inboundMessage.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ inboxAccountId: { in: [] } });
  });

  it("refuses to reply from a mailbox the member does not hold", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue(null as never);

    await expect(
      inboxService.replyToMessage("msg_1", "user_1", {
        organizationId: "org_1",
        subject: "Question",
        text: "Thanks.",
      })
    ).rejects.toThrow("Inbound message not found");

    const call = prismaMock.inboundMessage.findFirst.mock.calls[0][0];
    expect(call.where).toMatchObject({
      inboxAccountId: { in: ["inbox_1"] },
    });
    expect(manualEmailServiceMock.send).not.toHaveBeenCalled();
  });
});
