import type { Prisma } from "@prisma/client";
import {
  mailboxDraftSourceSchema,
  type MailboxDraftSource,
  type MailboxDraftStatus,
} from "@qqueue/shared";
import { HttpError } from "./http-error.js";
import { prisma } from "./prisma.js";
import { inboundMessageScope, resolveMailboxAccess } from "./mailbox-access.js";

export function mailboxDraftSource(value: unknown): MailboxDraftSource {
  const result = mailboxDraftSourceSchema.safeParse(value);
  if (!result.success)
    throw new HttpError(
      409,
      "This mailbox draft copy needs to be reopened from Drafts.",
      "draft_conflict"
    );
  return result.data;
}

/** Last synced source only. The original is never edited, deleted or sent here. */
export async function mailboxDraftStatus(
  source: MailboxDraftSource,
  organizationId: string,
  userId: string,
  db: Prisma.TransactionClient = prisma
): Promise<MailboxDraftStatus> {
  const access = await resolveMailboxAccess(userId, organizationId);
  // Freeze the observed source while accepting a review or send. Sync writes
  // set contentImportPending before replacing any attachment metadata.
  await db.$queryRaw`SELECT "id" FROM "InboundMessage" WHERE "id" = ${source.messageId} AND "organizationId" = ${organizationId} FOR SHARE`;
  const message = await db.inboundMessage.findFirst({
    where: {
      id: source.messageId,
      organizationId,
      ...inboundMessageScope(access),
    },
    include: { attachments: true },
  });
  const present =
    message?.remoteDraftVersion &&
    (await db.inboundMessageLocation.findFirst({
      where: {
        inboundMessageId: message.id,
        inboxFolderId: message.remoteDraftFolderId!,
        uid: message.remoteDraftUid!,
        uidValidity: message.remoteDraftUidValidity!,
        present: true,
        folder: { present: true, role: "DRAFTS" },
      },
      select: { id: true },
    }));
  if (!message || !present)
    return {
      state: "UNAVAILABLE",
      currentVersion: "unavailable",
      reviewed: source.reviewedVersion === "unavailable",
    };
  const loading =
    message.contentImportPending || message.bodyStatus !== "AVAILABLE";
  return {
    state: loading
      ? "LOADING"
      : message.remoteDraftVersion === source.version
        ? "UNCHANGED"
        : "UPDATED",
    currentVersion: message.remoteDraftVersion!,
    reviewed: !loading && source.reviewedVersion === message.remoteDraftVersion,
    ...(loading
      ? {}
      : {
          source: {
            id: message.id,
            subject: message.subject,
            html: message.html,
            text: message.text,
            to: message.to,
            cc: message.cc,
            bcc: message.remoteDraftBcc,
            attachments: message.attachments.map(
              ({ id, filename, size, contentId }) => ({
                id,
                filename,
                size,
                cid: contentId,
              })
            ),
          },
        }),
  };
}
