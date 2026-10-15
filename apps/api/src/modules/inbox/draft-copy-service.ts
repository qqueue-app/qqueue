import { createHash } from "node:crypto";
import type { MailboxDraftCopyInput } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import {
  inboundMessageScope,
  resolveMailboxAccess,
} from "../../lib/mailbox-access.js";
import { assertMayUseConnection } from "../../lib/send-as.js";
import { mailboxDraftSource } from "../../lib/mailbox-draft-source.js";

function textHtml(text: string) {
  return (
    "<p>" +
    text
      .replace(
        /[&<>]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!
      )
      .replace(/\r?\n/g, "<br>") +
    "</p>"
  );
}

const include = {
  attachments: {
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
      cid: true,
    },
  },
};
function conflict() {
  return new HttpError(
    409,
    "The mailbox draft changed or has not finished loading. Refresh it before continuing; the original is kept.",
    "mailbox_draft_conflict"
  );
}

export const inboxDraftCopyService = {
  async prepare(
    messageId: string,
    organizationId: string,
    userId: string,
    input: MailboxDraftCopyInput
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const where = {
      id: messageId,
      organizationId,
      ...inboundMessageScope(access),
    };
    const message = await prisma.inboundMessage.findFirst({
      where,
      include: {
        attachments: { orderBy: { partIndex: "asc" } },
        inboxAccount: { select: { email: true } },
      },
    });
    if (!message) throw new HttpError(404, "Message not found", "not_found");
    const key = {
      organizationId,
      createdByUserId: userId,
      clientId: input.clientId,
    };
    function replay(
      draft: Awaited<ReturnType<typeof prisma.emailDraft.findFirst>>
    ) {
      if (!draft) return;
      const source = mailboxDraftSource(draft.mailboxDraftSource);
      if (
        source.messageId !== messageId ||
        source.version !== input.expectedVersion ||
        draft.deletedAt ||
        draft.completedSendId
      )
        throw conflict();
      return draft;
    }
    const existing = await prisma.emailDraft.findFirst({ where: key, include });
    if (existing) return replay(existing)!;
    if (
      message.remoteDraftVersion !== input.expectedVersion ||
      message.contentImportPending ||
      message.bodyStatus !== "AVAILABLE"
    )
      throw conflict();
    if (message.replyTo.length > 1)
      throw new HttpError(
        400,
        "This draft has multiple Reply-To addresses. Create a new message with the reply address you want to use.",
        "validation_error"
      );
    if (
      message.attachments.length > 50 ||
      message.attachments.some((file) => file.size > env.ATTACHMENT_MAX_BYTES)
    )
      throw new HttpError(
        400,
        "This draft exceeds the outgoing file limits. Download the files you need and attach supported files to a new email.",
        "attachment_too_large"
      );
    for (const file of message.attachments) {
      if (file.storageStatus !== "AVAILABLE" || !file.contentHash)
        throw conflict();
      try {
        const content = await storage.getObject(file.storageKey);
        if (
          content.length !== file.size ||
          createHash("sha256").update(content).digest("hex") !==
            file.contentHash
        )
          throw new Error("File verification failed");
      } catch {
        await prisma.inboundAttachment.updateMany({
          where: { id: file.id, storageKey: file.storageKey },
          data: {
            storageStatus: "UNAVAILABLE",
            storageError:
              "This file needs to be loaded again before continuing this draft.",
          },
        });
        await prisma.inboundMessage.updateMany({
          where: { id: messageId },
          data: { contentImportPending: true },
        });
        throw conflict();
      }
    }
    const connection = await prisma.sMTPConnection.findFirst({
      where: {
        organizationId,
        fromEmail: { equals: message.inboxAccount.email, mode: "insensitive" },
        ...(access.unrestricted
          ? {}
          : { id: { in: access.smtpConnectionIds } }),
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (!connection)
      throw new HttpError(
        409,
        "This mailbox has no sending account you can use. Ask an administrator to connect one.",
        "missing_smtp_connection"
      );
    await assertMayUseConnection({
      userId,
      organizationId,
      smtpConnectionId: connection.id,
    });
    return prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mailbox-draft:${organizationId}:${userId}:${input.clientId}`},0))`;
      const again = await db.emailDraft.findFirst({ where: key, include });
      if (again) return replay(again)!;
      await db.$queryRaw`SELECT "id" FROM "InboundMessage" WHERE "id" = ${messageId} FOR SHARE`;
      const current = await db.inboundMessage.findFirst({
        where,
        include: { attachments: { orderBy: { partIndex: "asc" } } },
      });
      const present =
        current?.remoteDraftVersion &&
        (await db.inboundMessageLocation.findFirst({
          where: {
            inboundMessageId: messageId,
            inboxFolderId: current.remoteDraftFolderId!,
            uid: current.remoteDraftUid!,
            uidValidity: current.remoteDraftUidValidity!,
            present: true,
            folder: { present: true, role: "DRAFTS" },
          },
          select: { id: true },
        }));
      if (
        !current ||
        !present ||
        current.remoteDraftVersion !== input.expectedVersion ||
        current.contentImportPending ||
        current.bodyStatus !== "AVAILABLE" ||
        JSON.stringify(current.attachments) !==
          JSON.stringify(message.attachments)
      )
        throw conflict();
      return db.emailDraft.create({
        data: {
          ...key,
          subject: message.subject,
          html: message.html ?? textHtml(message.text ?? ""),
          text: message.text,
          to: message.to,
          cc: message.cc,
          bcc: message.remoteDraftBcc,
          replyTo: message.replyTo.join(", ") || undefined,
          smtpConnectionId: connection.id,
          variables: { qqueueMailboxDraftCopy: true },
          mailboxDraftSource: {
            messageId,
            version: input.expectedVersion,
            reviewedVersion: input.expectedVersion,
            ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
            references: message.references,
          },
          creationHash: createHash("sha256")
            .update(
              JSON.stringify([messageId, input.expectedVersion, input.clientId])
            )
            .digest("hex"),
          attachments: {
            create: message.attachments.map((file) => ({
              organizationId,
              createdByUserId: userId,
              filename: file.filename,
              contentType: file.contentType,
              size: file.size,
              storageKey: file.storageKey,
              cid: file.contentId,
            })),
          },
        },
        include,
      });
    });
  },
};
