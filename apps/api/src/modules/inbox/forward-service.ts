import { plainTextFromHtml } from "@qqueue/email-engine";
import { createHash } from "node:crypto";
import type { InboundForwardInput } from "@qqueue/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import {
  inboundMessageScope,
  resolveMailboxAccess,
} from "../../lib/mailbox-access.js";
import { inboxService } from "./service.js";

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );
}

const draftInclude = {
  attachments: {
    select: { id: true, filename: true, contentType: true, size: true },
  },
};

/** Prepare a personal draft only. Sending still uses the manual email pipeline. */
export const inboxForwardService = {
  async prepare(
    messageId: string,
    organizationId: string,
    userId: string,
    input: InboundForwardInput
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const message = await prisma.inboundMessage.findFirst({
      where: { id: messageId, organizationId, ...inboundMessageScope(access) },
      include: { inboxAccount: { select: { email: true } }, attachments: true },
    });
    if (!message) throw new HttpError(404, "Message not found", "not_found");
    const key = {
      organizationId,
      createdByUserId: userId,
      clientId: input.clientId,
    };
    const existing = await prisma.emailDraft.findFirst({
      where: key,
      include: draftInclude,
    });
    if (existing) {
      if (
        (existing.variables as Record<string, unknown> | null)
          ?.qqueueForwardSource !== messageId ||
        existing.deletedAt ||
        existing.completedSendId
      )
        throw new HttpError(
          409,
          "This forward draft was changed or completed. Check Drafts or Outbox before starting again.",
          "conflict"
        );
      return existing;
    }
    if (message.bodyStatus === "UNAVAILABLE" || message.contentImportPending)
      throw new HttpError(
        409,
        "Reload the original message and its attachments before forwarding. No forward draft was created.",
        "conflict"
      );
    if (message.attachments.length > 50)
      throw new HttpError(
        400,
        "This message has more than 50 files. Download the files you need and attach them to a new email.",
        "validation_error"
      );
    if (
      message.attachments.some((file) => file.size > env.ATTACHMENT_MAX_BYTES)
    )
      throw new HttpError(
        400,
        "An original file exceeds the outgoing attachment size limit. Download the files you need and attach supported files to a new email.",
        "attachment_too_large"
      );
    // Verify every selected original file before accepting a complete forward.
    // The download path checks grants and marks missing blobs for recovery.
    for (const file of message.attachments)
      await inboxService.downloadAttachment(file.id, userId, organizationId);
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
    const subject = /^(fwd?|forward):/i.test(message.subject)
      ? message.subject
      : `Fwd: ${message.subject || "(no subject)"}`;
    const header = [
      "---------- Forwarded message ----------",
      `From: ${message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}`,
      `Date: ${message.receivedAt.toISOString()}`,
      `Subject: ${message.subject}`,
      `To: ${message.to.join(", ")}`,
      ...(message.cc.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    ].join("\n");
    const html = `<p></p><blockquote><p>${escape(header).replace(/\n/g, "<br>")}</p><p>${escape(message.text ?? plainTextFromHtml(message.html ?? "")).replace(/\r?\n/g, "<br>")}</p></blockquote>`;
    return prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`forward:${organizationId}:${userId}:${input.clientId}`},0))`;
      const replay = await db.emailDraft.findFirst({
        where: key,
        include: draftInclude,
      });
      if (replay) {
        if (
          (replay.variables as Record<string, unknown> | null)
            ?.qqueueForwardSource !== messageId ||
          replay.deletedAt ||
          replay.completedSendId
        )
          throw new HttpError(
            409,
            "This forward draft was changed or completed. Check Drafts or Outbox.",
            "conflict"
          );
        return replay;
      }
      return db.emailDraft.create({
        data: {
          ...key,
          subject,
          html,
          smtpConnectionId: connection.id,
          variables: { qqueueForwardSource: messageId },
          creationHash: createHash("sha256")
            .update(JSON.stringify([messageId, input.clientId]))
            .digest("hex"),
          attachments: {
            create: message.attachments.map((file) => ({
              organizationId,
              createdByUserId: userId,
              filename: file.filename,
              contentType: file.contentType,
              size: file.size,
              storageKey: file.storageKey,
            })),
          },
        },
        include: draftInclude,
      });
    });
  },
};
