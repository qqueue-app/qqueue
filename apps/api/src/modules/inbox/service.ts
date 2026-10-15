import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
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
import {
  emailJobScope,
  inboundMessageScope,
  resolveMailboxAccess,
} from "../../lib/mailbox-access.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";
import { inboxSyncQueue } from "../../queues/inbox-sync.queue.js";
import { manualEmailService } from "../manual-email/service.js";

const messageInclude = {
  locations: {
    where: { present: true, folder: { present: true } },
    select: {
      id: true,
      inboxFolderId: true,
      folder: {
        select: { path: true, name: true, role: true, isPrimary: true },
      },
    },
  },
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
      // The reader needs this to match an inline part to the `cid:` reference
      // in the body HTML; without it embedded images render broken.
      contentId: true,
      storageStatus: true,
      storageError: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.InboundMessageInclude;

type IncludedMessage = Prisma.InboundMessageGetPayload<{
  include: typeof messageInclude;
}>;

async function withDsnAttribution(
  organizationId: string,
  messages: IncludedMessage[]
) {
  const dsnIds = messages
    .filter((message) => message.isDsn)
    .map((message) => message.id);
  if (dsnIds.length === 0) {
    return messages.map((message) => ({ ...message, dsnAttribution: null }));
  }

  const events = await prisma.emailEvent.findMany({
    where: {
      organizationId,
      type: { in: ["BOUNCED", "DELIVERED"] },
      OR: dsnIds.map((id) => ({
        metadata: { path: ["inboundMessageId"], equals: id },
      })),
    },
    select: { metadata: true },
  });
  const attributed = new Set(
    events.flatMap((event) => {
      const metadata = event.metadata as { inboundMessageId?: unknown } | null;
      return typeof metadata?.inboundMessageId === "string"
        ? [metadata.inboundMessageId]
        : [];
    })
  );

  return messages.map((message) => ({
    ...message,
    dsnAttribution: message.isDsn
      ? attributed.has(message.id)
        ? ("ATTRIBUTED" as const)
        : ("UNATTRIBUTED" as const)
      : null,
  }));
}

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

function inboxFolderScope(
  view = "INBOX",
  folderId?: string
): Prisma.InboundMessageWhereInput {
  if (folderId)
    return {
      locations: {
        some: {
          inboxFolderId: folderId,
          present: true,
          folder: { present: true },
        },
      },
    };
  if (view === "ALL") return {};
  if (view === "FLAGGED") return { flagged: true };
  if (view === "INBOX")
    return {
      OR: [
        {
          locations: {
            some: {
              present: true,
              folder: {
                present: true,
                OR: [{ role: "INBOX" }, { isPrimary: true }],
              },
            },
          },
        },
        // Admin-imported mail without a verified server location remains readable.
        { locations: { none: {} } },
      ],
    };
  return {
    locations: {
      some: { present: true, folder: { present: true, role: view } },
    },
  };
}

export const inboxService = {
  async listFolders(
    organizationId: string,
    userId: string,
    inboxAccountId?: string
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    return prisma.inboxFolder.findMany({
      where: {
        inboxAccount: {
          organizationId,
          ...(access.unrestricted
            ? {}
            : { id: { in: access.inboxAccountIds } }),
          ...(inboxAccountId ? { AND: [{ id: inboxAccountId }] } : {}),
        },
      },
      select: {
        id: true,
        inboxAccountId: true,
        path: true,
        name: true,
        role: true,
        isPrimary: true,
        present: true,
        lastSyncedAt: true,
        historyBeforeUid: true,
        lastSyncError: true,
      },
      orderBy: [{ role: "asc" }, { path: "asc" }],
    });
  },
  async markFlagged(
    messageId: string,
    organizationId: string,
    userId: string,
    flagged: boolean
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const changed = await prisma.inboundMessage.updateMany({
      where: { id: messageId, organizationId, ...inboundMessageScope(access) },
      data: {
        flagged,
        flagRevision: { increment: 1 },
        flagPending: true,
        flagSyncError: null,
      },
    });
    if (!changed.count)
      throw new HttpError(404, "Message not found", "not_found");
    const message = await prisma.inboundMessage.findFirst({
      where: { id: messageId, organizationId },
      include: messageInclude,
    });
    if (message)
      await this.requestSync(
        organizationId,
        userId,
        message.inboxAccountId
      ).catch(() => undefined);
    return message;
  },
  async requestSync(
    organizationId: string,
    userId: string,
    inboxAccountId?: string
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const accounts = await prisma.inboxAccount.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        ...(access.unrestricted ? {} : { id: { in: access.inboxAccountIds } }),
        ...(inboxAccountId ? { AND: [{ id: inboxAccountId }] } : {}),
      },
      select: { id: true },
    });
    await Promise.all(
      accounts.map((account) =>
        inboxSyncQueue.add(
          "sync-inbox",
          { inboxAccountId: account.id },
          {
            // A request arriving at the end of an active sync must get a new
            // pass. Reusing its job ID would silently discard that request.
            jobId: `inbox-sync-${account.id}-${randomUUID()}`,
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 },
          }
        )
      )
    );
    return { queued: accounts.length };
  },
  async getConversation(
    messageId: string,
    organizationId: string,
    userId: string
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const seed = await prisma.inboundMessage.findFirst({
      where: { id: messageId, organizationId, ...inboundMessageScope(access) },
      include: messageInclude,
    });
    if (!seed) throw new HttpError(404, "Message not found", "not_found");
    // Expand header relationships within this mailbox. A search or unread
    // filter selects a conversation, never trims the conversation being read.
    const messages = new Map([[seed.id, seed]]);
    const headers = new Set([
      seed.messageId,
      ...seed.references,
      ...(seed.inReplyTo ? [seed.inReplyTo] : []),
    ]);
    for (let round = 0; round < 20; round++) {
      const related = await prisma.inboundMessage.findMany({
        where: {
          organizationId,
          inboxAccountId: seed.inboxAccountId,
          OR: [
            { messageId: { in: [...headers] } },
            { inReplyTo: { in: [...headers] } },
            { references: { hasSome: [...headers] } },
          ],
        },
        include: messageInclude,
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        take: 1001,
      });
      let expanded = false;
      for (const message of related) {
        messages.set(message.id, message);
        for (const header of [
          message.messageId,
          ...message.references,
          ...(message.inReplyTo ? [message.inReplyTo] : []),
        ]) {
          if (!headers.has(header)) {
            headers.add(header);
            expanded = true;
          }
        }
      }
      if (messages.size > 1000 || (round === 19 && expanded))
        throw new HttpError(
          413,
          "This conversation is too large to open. Narrow it by mailbox."
        );
      if (!expanded) break;
    }
    const outgoing = await prisma.emailJob.findMany({
      where: {
        organizationId,
        NOT: { origin: "SYSTEM" },
        groupPrimary: true,
        AND: [
          emailJobScope(access),
          {
            OR: [
              { messageId: { in: [...headers] } },
              { inReplyTo: { in: [...headers] } },
              { references: { hasSome: [...headers] } },
            ],
          },
        ],
      },
      select: {
        id: true,
        subject: true,
        html: true,
        text: true,
        toEmail: true,
        cc: true,
        status: true,
        groupStatus: true,
        visibleTo: true,
        visibleCc: true,
        sentAt: true,
        createdAt: true,
        messageId: true,
        smtpConnection: { select: { fromEmail: true, fromName: true } },
        createdByUserId: true,
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
            cid: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 1000,
    });
    const authors = await prisma.user.findMany({
      where: {
        id: {
          in: outgoing.flatMap((job) =>
            job.createdByUserId ? [job.createdByUserId] : []
          ),
        },
      },
      select: { id: true, name: true },
    });
    return {
      messages: await withDsnAttribution(
        organizationId,
        [...messages.values()].sort(
          (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
        )
      ),
      outgoing: outgoing
        .filter(
          (job) =>
            ![...messages.values()].some(
              (message) => message.messageId === job.messageId
            )
        )
        .map((job) => ({
          ...job,
          status: job.groupStatus ?? job.status,
          toEmail: job.visibleTo?.length
            ? job.visibleTo.join(", ")
            : job.toEmail,
          cc: job.visibleCc?.length ? job.visibleCc : job.cc,
          attachments: job.attachments.map((file) => ({
            ...file,
            isInline: Boolean(file.cid),
            contentId: file.cid,
          })),
          sentByName:
            authors.find((user) => user.id === job.createdByUserId)?.name ??
            "Team",
        })),
    };
  },
  /**
   * The mailboxes this person may read. Backs both the settings list and the
   * inbox's mailbox filter, so a member is never offered a mailbox whose
   * messages the list would then refuse to show.
   */
  async listAccounts(organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    return prisma.inboxAccount.findMany({
      where: {
        organizationId,
        ...(access.unrestricted ? {} : { id: { in: access.inboxAccountIds } }),
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
        historyBeforeUid: true,
        lastSyncError: true,
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

    const data = {
      organizationId: input.organizationId,
      name: input.name,
      email: input.email,
      host: input.host,
      port: input.port,
      secure: input.secure,
      usernameEncrypted: encryptSecret(input.username),
      passwordEncrypted: encryptSecret(input.password),
      mailbox: input.mailbox,
    };
    const select = {
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
      lastSyncError: true,
      createdAt: true,
      updatedAt: true,
    } satisfies Prisma.InboxAccountSelect;
    const existing = await prisma.inboxAccount.findUnique({
      where: {
        organizationId_email: {
          organizationId: input.organizationId,
          email: input.email,
        },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === "ACTIVE")
        throw new HttpError(
          409,
          "This mailbox is already connected.",
          "conflict"
        );
      return prisma.inboxAccount.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: "ACTIVE",
          lastSeenUid: null,
          uidValidity: null,
          lastSyncError: null,
        },
        select,
      });
    }
    return prisma.inboxAccount.create({ data, select });
  },

  async updateAccount(
    id: string,
    userId: string,
    input: InboxAccountUpdateInput,
    organizationId: string
  ) {
    const { count } = await prisma.inboxAccount.updateMany({
      where: {
        id,
        organizationId,
        organization: {
          members: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } },
        },
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
        lastSyncError: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async deleteAccount(id: string, userId: string, organizationId: string) {
    // Disconnecting must never cascade into deleting the team's received mail.
    const { count } = await prisma.inboxAccount.updateMany({
      where: {
        id,
        organizationId,
        organization: {
          members: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } },
        },
      },
      data: { status: "DISABLED" },
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
        replyTo: input.replyTo,
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
        replyTo: input.replyTo,
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

  /**
   * Unread human mail, for the navigation badge. Bounce reports are excluded:
   * they are plumbing the deliverability pages account for, and counting them
   * here would show an inbox badge nobody can clear by reading mail.
   *
   * Capped so a neglected mailbox reports "99+" instead of making the database
   * count a hundred thousand rows every time the badge refreshes.
   */
  async unreadCount(organizationId: string, userId: string) {
    const CAP = 99;
    const access = await resolveMailboxAccess(userId, organizationId);
    const count = await prisma.inboundMessage.count({
      // Scoped like the list itself: a badge counting mail the reader cannot
      // open is one they can never clear.
      where: {
        organizationId,
        readAt: null,
        isDsn: false,
        AND: [inboxFolderScope()],
        ...inboundMessageScope(access),
      },
      take: CAP + 1,
    });
    return { count: Math.min(count, CAP), hasMore: count > CAP };
  },

  async listMessages(query: InboundMessageQueryInput, userId: string) {
    const access = await resolveMailboxAccess(userId, query.organizationId);
    const where: Prisma.InboundMessageWhereInput = {
      organizationId: query.organizationId,
      ...inboundMessageScope(access),
      ...(query.inboxAccountId
        ? {
            inboxAccountId: {
              in: access.unrestricted
                ? [query.inboxAccountId]
                : access.inboxAccountIds.filter(
                    (id) => id === query.inboxAccountId
                  ),
            },
          }
        : {}),
      ...(query.read === "read" ? { readAt: { not: null } } : {}),
      ...(query.read === "unread" ? { readAt: null } : {}),
      AND: [inboxFolderScope(query.view, query.folderId)],
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
      messages.length > query.limit ? messages[query.limit - 1]?.id : undefined;

    return {
      data: await withDsnAttribution(
        query.organizationId,
        messages.slice(0, query.limit)
      ),
      nextCursor,
    };
  },

  async replyToMessage(
    messageId: string,
    userId: string,
    input: InboundMessageReplyInput
  ) {
    const access = await resolveMailboxAccess(userId, input.organizationId);
    const message = await prisma.inboundMessage.findFirst({
      where: {
        id: messageId,
        organizationId: input.organizationId,
        ...inboundMessageScope(access),
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

    if (message.bodyStatus === "UNAVAILABLE")
      throw new HttpError(
        409,
        "Reload this message before sending a reply so its original message identity and recipients can be recovered.",
        "conflict"
      );

    // A reply must use the receiving mailbox's identity unless the sender
    // deliberately chose another permitted account. Never fall back to the org default.
    const connection = await prisma.sMTPConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        ...(input.smtpConnectionId
          ? { id: input.smtpConnectionId }
          : {
              fromEmail: {
                equals: message.inboxAccount.email,
                mode: "insensitive",
              },
            }),
        ...(access.unrestricted
          ? {}
          : {
              id: {
                in: access.smtpConnectionIds.filter(
                  (id) =>
                    !input.smtpConnectionId || id === input.smtpConnectionId
                ),
              },
            }),
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, fromEmail: true },
    });
    if (!connection) {
      throw new HttpError(
        409,
        "This mailbox has no sending account you can use. Ask an administrator to connect one.",
        "missing_smtp_connection"
      );
    }
    const ownAddresses = new Set(
      [message.inboxAccount.email, connection.fromEmail].map((email) =>
        email.toLowerCase()
      )
    );
    const replyRecipients = message.replyTo?.length
      ? message.replyTo
      : [message.fromEmail];
    const to = input.replyAll
      ? [
          ...new Set(
            [...replyRecipients, ...(message.to ?? [])].map((email) =>
              email.toLowerCase()
            )
          ),
        ].filter((email) => !ownAddresses.has(email))
      : replyRecipients;
    const cc = input.replyAll
      ? (message.cc ?? []).filter(
          (email) =>
            !ownAddresses.has(email.toLowerCase()) &&
            !to.includes(email.toLowerCase())
        )
      : undefined;

    const result = await manualEmailService.send(
      {
        organizationId: input.organizationId,
        to: input.to ?? to,
        cc: input.cc ?? cc,
        bcc: input.bcc,
        draftId: input.draftId,
        expectedRevision: input.expectedRevision,
        smtpConnectionId: connection.id,
        subject: replySubject(input.subject),
        html: input.html,
        text: input.text,
        attachmentIds: input.attachmentIds,
        idempotencyKey: input.idempotencyKey,
        inReplyTo: message.messageId,
        references: replyReferences(message),
      },
      userId
    );

    await prisma.inboundMessage.update({
      where: { id: messageId },
      data: {
        readAt: message.readAt ?? new Date(),
        readRevision: { increment: 1 },
        readPending: true,
        readAttemptedAt: null,
        readSyncError: null,
      },
    });

    return result;
  },

  async markManyRead(
    organizationId: string,
    userId: string,
    messageIds: string[],
    read: boolean
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const result = await prisma.inboundMessage.updateMany({
      where: {
        organizationId,
        id: { in: messageIds },
        ...inboundMessageScope(access),
      },
      data: {
        readAt: read ? new Date() : null,
        readRevision: { increment: 1 },
        readPending: true,
        readAttemptedAt: null,
        readSyncError: null,
      },
    });
    if (result.count)
      await this.requestSync(organizationId, userId).catch(() => undefined);
    return { updated: result.count };
  },

  async markRead(
    id: string,
    userId: string,
    organizationId: string,
    read: boolean
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const { count } = await prisma.inboundMessage.updateMany({
      where: {
        id,
        organizationId,
        ...inboundMessageScope(access),
      },
      data: {
        readAt: read ? new Date() : null,
        readRevision: { increment: 1 },
        readPending: true,
        readAttemptedAt: null,
        readSyncError: null,
      },
    });
    if (count === 0) {
      throw new HttpError(404, "Inbound message not found", "not_found");
    }
    const message = await prisma.inboundMessage.findUniqueOrThrow({
      where: { id },
      include: messageInclude,
    });
    await this.requestSync(
      organizationId,
      userId,
      message.inboxAccountId
    ).catch(() => undefined);
    return message;
  },

  /**
   * Fetch an inbound attachment (metadata + blob) for download.
   *
   * Scoped to the mailbox rather than to an uploading user — unlike outbound
   * attachments, nobody here authored the file; it arrived in a mailbox, so
   * whoever may read the message may read its parts, and whoever may not, may
   * not. The scope goes through the parent message: an attachment is only ever
   * as private as the mail it came on.
   *
   * This route is authenticated on purpose. It is the inverse of the public
   * /images/:publicId endpoint: that one is public because a *recipient's* mail
   * client must fetch it with no session, whereas these are private files sent
   * to us and must never be reachable without auth.
   */
  async downloadAttachment(id: string, userId: string, organizationId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const attachment = await prisma.inboundAttachment.findFirst({
      where: {
        id,
        organizationId,
        inboundMessage: inboundMessageScope(access),
      },
    });
    if (!attachment) {
      throw new HttpError(404, "Attachment not found", "not_found");
    }

    if (attachment.storageStatus && attachment.storageStatus !== "AVAILABLE")
      throw new HttpError(
        409,
        attachment.storageError ??
          "This file is not available yet. Retry loading its attachments.",
        "conflict"
      );

    let body;
    try {
      body = await storage.getObject(attachment.storageKey);
    } catch {
      await prisma.inboundAttachment.update({
        where: { id },
        data: {
          storageStatus: "UNAVAILABLE",
          storageError:
            "The stored file could not be loaded. Retry loading its attachments.",
        },
      });
      await prisma.inboundMessage.updateMany({
        where: { id: attachment.inboundMessageId },
        data: { contentImportPending: true },
      });
      throw new HttpError(
        503,
        "The stored file could not be loaded. It will retry from the mailbox; you can also retry loading its attachments.",
        "attachment_unavailable"
      );
    }
    return { attachment, body };
  },

  async retryContent(id: string, organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const message = await prisma.inboundMessage.findFirst({
      where: { id, organizationId, ...inboundMessageScope(access) },
      include: { inboxAccount: true },
    });
    if (!message) throw new HttpError(404, "Message not found", "not_found");
    if (!message.imapUid || message.inboxAccount.status !== "ACTIVE")
      throw new HttpError(
        409,
        "Reconnect this mailbox before retrying its files.",
        "conflict"
      );
    await prisma.inboundMessage.updateMany({
      where: { id, organizationId },
      data: { contentImportPending: true, contentAttemptedAt: null },
    });
    await this.requestSync(
      organizationId,
      userId,
      message.inboxAccountId
    ).catch(() => undefined);
    return { queued: true };
  },
};
