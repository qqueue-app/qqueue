import type { Prisma } from "@prisma/client";
import type {
  InboxAccountInput,
  InboxAccountUpdateInput,
  InboundMessageQueryInput,
  InboundMessageReplyInput,
  InboundMessageStoreInput,
} from "@qqueue/shared";
import { ImapFlow } from "imapflow";
import { encryptSecret } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";
import { manualEmailService } from "../manual-email/service.js";

const messageInclude = {
  emailJob: {
    select: {
      id: true,
      subject: true,
      toEmail: true,
      messageId: true,
    },
  },
  // Metadata only — blobs are fetched one at a time through the download route.
  attachments: {
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
      isInline: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.InboundMessageInclude;

function candidateThreadHeaders(input: {
  inReplyTo?: string | null;
  references?: string[];
}) {
  return [input.inReplyTo, ...(input.references ?? [])].filter(
    (value): value is string => Boolean(value)
  );
}

function replySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject || "(no subject)"}`;
}

function replyReferences(message: {
  references: string[];
  inReplyTo?: string | null;
  messageId: string;
}) {
  return [
    ...new Set(
      [...message.references, message.inReplyTo, message.messageId].filter(
        (value): value is string => Boolean(value)
      )
    ),
  ];
}

export const inboxService = {
  listAccounts(organizationId: string) {
    return prisma.inboxAccount.findMany({
      where: { organizationId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        email: true,
        host: true,
        port: true,
        secure: true,
        mailbox: true,
        status: true,
        lastSyncedAt: true,
        lastSeenUid: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async verifyConnection(input: InboxAccountInput) {
    const client = new ImapFlow({
      host: input.host,
      port: input.port,
      secure: input.secure,
      auth: {
        user: input.username,
        pass: input.password,
      },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
    });

    try {
      await client.connect();
      await client.mailboxOpen(input.mailbox, { readOnly: true });
    } catch {
      throw new HttpError(
        400,
        "Could not connect to the IMAP mailbox with those settings",
        "validation_error"
      );
    } finally {
      client.close();
    }
  },

  async createAccount(input: InboxAccountInput) {
    await this.verifyConnection(input);

    return prisma.inboxAccount.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        email: input.email,
        host: input.host,
        port: input.port,
        secure: input.secure,
        usernameEncrypted: encryptSecret(input.username),
        passwordEncrypted: encryptSecret(input.password),
        mailbox: input.mailbox,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        email: true,
        host: true,
        port: true,
        secure: true,
        mailbox: true,
        status: true,
        lastSyncedAt: true,
        lastSeenUid: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async updateAccount(
    id: string,
    userId: string,
    input: InboxAccountUpdateInput
  ) {
    const { count } = await prisma.inboxAccount.updateMany({
      where: {
        id,
        organization: { members: { some: { userId } } },
      },
      data: input,
    });
    if (count === 0) {
      throw new HttpError(404, "Inbox account not found", "not_found");
    }
    return prisma.inboxAccount.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        name: true,
        email: true,
        host: true,
        port: true,
        secure: true,
        mailbox: true,
        status: true,
        lastSyncedAt: true,
        lastSeenUid: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async deleteAccount(id: string, userId: string) {
    const { count } = await prisma.inboxAccount.deleteMany({
      where: {
        id,
        organization: { members: { some: { userId } } },
      },
    });
    if (count === 0) {
      throw new HttpError(404, "Inbox account not found", "not_found");
    }
  },

  async storeInboundMessage(input: InboundMessageStoreInput) {
    const account = await prisma.inboxAccount.findFirst({
      where: {
        id: input.inboxAccountId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!account) {
      throw new HttpError(404, "Inbox account not found", "not_found");
    }

    const headers = candidateThreadHeaders(input);
    const emailJob = headers.length
      ? await prisma.emailJob.findFirst({
          where: {
            organizationId: input.organizationId,
            messageId: { in: headers },
          },
          select: { id: true },
        })
      : null;

    return prisma.inboundMessage.upsert({
      where: {
        inboxAccountId_messageId: {
          inboxAccountId: input.inboxAccountId,
          messageId: input.messageId,
        },
      },
      create: {
        organizationId: input.organizationId,
        inboxAccountId: input.inboxAccountId,
        emailJobId: emailJob?.id,
        messageId: input.messageId,
        inReplyTo: input.inReplyTo,
        references: input.references,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.text,
        html: input.html,
        receivedAt: new Date(input.receivedAt),
        imapUid: input.imapUid,
      },
      update: {
        emailJobId: emailJob?.id,
        inReplyTo: input.inReplyTo,
        references: input.references,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.text,
        html: input.html,
        receivedAt: new Date(input.receivedAt),
        imapUid: input.imapUid,
      },
      include: messageInclude,
    });
  },

  async listMessages(query: InboundMessageQueryInput) {
    const where: Prisma.InboundMessageWhereInput = {
      organizationId: query.organizationId,
      ...(query.read === "read" ? { readAt: { not: null } } : {}),
      ...(query.read === "unread" ? { readAt: null } : {}),
    };

    if (query.q) {
      where.OR = [
        { subject: { contains: query.q, mode: "insensitive" } },
        { fromEmail: { contains: query.q, mode: "insensitive" } },
        { fromName: { contains: query.q, mode: "insensitive" } },
        { text: { contains: query.q, mode: "insensitive" } },
      ];
    }

    const messages = await prisma.inboundMessage.findMany({
      where,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      include: messageInclude,
    });

    const nextCursor =
      messages.length > query.limit ? messages[query.limit]?.id : undefined;

    return {
      data: messages.slice(0, query.limit),
      nextCursor,
    };
  },

  async replyToMessage(
    messageId: string,
    userId: string,
    input: InboundMessageReplyInput
  ) {
    const message = await prisma.inboundMessage.findFirst({
      where: {
        id: messageId,
        organizationId: input.organizationId,
        organization: { members: { some: { userId } } },
      },
      include: {
        inboxAccount: {
          select: { email: true },
        },
      },
    });
    if (!message) {
      throw new HttpError(404, "Inbound message not found", "not_found");
    }

    const result = await manualEmailService.send(
      {
        organizationId: input.organizationId,
        to: [message.fromEmail],
        replyTo: message.inboxAccount.email,
        smtpConnectionId: input.smtpConnectionId,
        subject: replySubject(input.subject),
        html: input.html,
        text: input.text,
        inReplyTo: message.messageId,
        references: replyReferences(message),
      },
      userId
    );

    await prisma.inboundMessage.update({
      where: { id: messageId },
      data: { readAt: message.readAt ?? new Date() },
    });

    return result;
  },

  async markRead(id: string, userId: string, read: boolean) {
    const { count } = await prisma.inboundMessage.updateMany({
      where: {
        id,
        organization: { members: { some: { userId } } },
      },
      data: { readAt: read ? new Date() : null },
    });
    if (count === 0) {
      throw new HttpError(404, "Inbound message not found", "not_found");
    }
    return prisma.inboundMessage.findUniqueOrThrow({
      where: { id },
      include: messageInclude,
    });
  },

  /**
   * Fetch an inbound attachment (metadata + blob) for download.
   *
   * Scoped to organization membership rather than to an uploading user — unlike
   * outbound attachments, nobody here authored the file; it arrived in the org's
   * shared mailbox, so anyone who can read the message can read its parts.
   *
   * This route is authenticated on purpose. It is the inverse of the public
   * /images/:publicId endpoint: that one is public because a *recipient's* mail
   * client must fetch it with no session, whereas these are private files sent
   * to us and must never be reachable without auth.
   */
  async downloadAttachment(id: string, userId: string) {
    const attachment = await prisma.inboundAttachment.findFirst({
      where: {
        id,
        organization: { members: { some: { userId } } },
      },
    });
    if (!attachment) {
      throw new HttpError(404, "Attachment not found", "not_found");
    }

    const body = await storage.getObject(attachment.storageKey);
    return { attachment, body };
  },
};
