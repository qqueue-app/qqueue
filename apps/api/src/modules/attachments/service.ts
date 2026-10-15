import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { EmailAttachment } from "@qqueue/email-engine";
import {
  base64DecodedBytes,
  INLINE_ATTACHMENT_MAX_BYTES,
  type InlineAttachmentInput,
} from "@qqueue/shared";
import { env } from "../../config/env.js";
import { isPrismaKnownRequestError } from "../../lib/prisma-error.js";
import { HttpError } from "../../lib/http-error.js";
import {
  emailJobScope,
  resolveMailboxAccess,
} from "../../lib/mailbox-access.js";
import { getMembership } from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";

export interface UploadAttachmentInput {
  organizationId: string;
  userId: string;
  filename: string;
  contentType: string;
  size: number;
  buffer: Buffer;
  emailDraftId?: string;
  uploadId?: string;
}

export interface AttachmentMetadata {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

// Strip any path components and characters that don't belong in a stored
// filename, so a crafted name can't escape the object key or break headers.
function sanitizeFilename(name: string): string {
  const base = basename(name)
    .replace(/[^\w.\- ]+/g, "_")
    .trim();
  const cleaned = base.length > 0 ? base : "attachment";
  return cleaned.slice(0, 200);
}

function toMetadata(attachment: {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}): AttachmentMetadata {
  return {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

export const attachmentService = {
  /**
   * Persist an uploaded file: blob to object storage, metadata to Postgres. The
   * row is optionally linked to a draft so resuming the composer restores its
   * attachments; it is linked to the EmailJob later, at send time.
   */
  async upload(input: UploadAttachmentInput): Promise<AttachmentMetadata> {
    if (input.size <= 0) {
      throw new HttpError(400, "Attachment is empty", "validation_error");
    }
    if (input.size > env.ATTACHMENT_MAX_BYTES) {
      throw new HttpError(
        400,
        `Attachment exceeds the ${env.ATTACHMENT_MAX_BYTES}-byte limit`,
        "attachment_too_large"
      );
    }

    const contentHash = createHash("sha256")
      .update(input.buffer)
      .update(
        JSON.stringify([input.filename, input.contentType, input.emailDraftId])
      )
      .digest("hex");
    const uploadKey = input.uploadId
      ? {
          organizationId: input.organizationId,
          createdByUserId: input.userId,
          uploadId: input.uploadId,
        }
      : null;
    if (uploadKey) {
      const existing = await prisma.emailAttachment.findUnique({
        where: { organizationId_createdByUserId_uploadId: uploadKey },
      });
      if (existing) {
        if (existing.contentHash !== contentHash)
          throw new HttpError(
            409,
            "This upload identity belongs to a different file.",
            "attachment_conflict"
          );
        return toMetadata(existing);
      }
    }
    // A draft id is only honored when it belongs to the same user + org.
    let emailDraftId: string | undefined;
    if (input.emailDraftId) {
      const draft = await prisma.emailDraft.findFirst({
        where: {
          id: input.emailDraftId,
          organizationId: input.organizationId,
          createdByUserId: input.userId,
        },
        select: { id: true },
      });
      if (!draft) throw new HttpError(404, "Draft not found", "not_found");
      emailDraftId = draft.id;
    }

    const filename = sanitizeFilename(input.filename);
    const storageKey = `org/${input.organizationId}/${randomUUID()}-${filename}`;

    await storage.putObject({
      key: storageKey,
      body: input.buffer,
      contentType: input.contentType,
    });

    let attachment;
    try {
      attachment = await prisma.$transaction(async (db) => {
        if (emailDraftId) {
          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"draft:" + emailDraftId}, 0))`;
          const draft = await db.emailDraft.findFirst({
            where: {
              id: emailDraftId,
              organizationId: input.organizationId,
              createdByUserId: input.userId,
              completedSendId: null,
              deletedAt: null,
            },
          });
          if (!draft)
            throw new HttpError(
              409,
              "This draft was completed while the file was uploading. Your file was not added to the accepted message.",
              "attachment_conflict"
            );
        }
        return db.emailAttachment.create({
          data: {
            organizationId: input.organizationId,
            emailDraftId,
            uploadId: input.uploadId,
            contentHash,
            filename,
            contentType: input.contentType,
            size: input.size,
            storageKey,
            createdByUserId: input.userId,
          },
        });
      });
    } catch (error) {
      await storage.deleteObject(storageKey).catch(() => undefined);
      if (uploadKey && isPrismaKnownRequestError(error, "P2002")) {
        const existing = await prisma.emailAttachment.findUnique({
          where: { organizationId_createdByUserId_uploadId: uploadKey },
        });
        if (existing?.contentHash === contentHash) return toMetadata(existing);
      }
      throw error;
    }
    return toMetadata(attachment);
  },

  /**
   * Fetch an attachment (metadata + blob) for download.
   *
   * Two ways to be entitled to one, because an attachment has two lives:
   *
   * 1. You uploaded it. That covers a file still sitting on a draft, which is
   *    personal — nobody else's business until the message goes out.
   * 2. It travelled with a message you may read. Once sent, an attachment is
   *    part of the organization's mail log, and it is scoped exactly like the
   *    log: the same emailJobScope the sent archive and outbox already use, so
   *    an admin can open what their org sent and a member cannot open what went
   *    out from a mailbox they were never given.
   *
   * Uploader-only was the whole rule before the sent archive could show a
   * message's body, and it made every attachment in the archive undownloadable
   * by anyone but the person who attached it — including the owner of the
   * mailbox it was sent from.
   */
  async download(id: string, userId: string) {
    const attachment = await prisma.emailAttachment.findFirst({
      where: { id },
    });
    if (!attachment) {
      throw new HttpError(404, "Attachment not found", "not_found");
    }

    if (attachment.createdByUserId !== userId) {
      // Unsent (draft or orphaned) rows have no message to inherit access
      // from, so the uploader check above was their only door.
      if (!attachment.emailJobId) {
        throw new HttpError(404, "Attachment not found", "not_found");
      }

      // Membership first, and 404 on its absence rather than the 403
      // resolveMailboxAccess would throw: to someone outside the organization
      // this id must look like it does not exist, not like something they are
      // being kept out of.
      const membership = await getMembership(userId, attachment.organizationId);
      if (!membership) {
        throw new HttpError(404, "Attachment not found", "not_found");
      }

      const access = await resolveMailboxAccess(
        userId,
        attachment.organizationId
      );
      const readable = await prisma.emailJob.findFirst({
        where: {
          id: attachment.emailJobId,
          organizationId: attachment.organizationId,
          NOT: { origin: "SYSTEM" },
          ...(access.unrestricted ? {} : { AND: [emailJobScope(access)] }),
        },
        select: { id: true },
      });
      if (!readable) {
        throw new HttpError(404, "Attachment not found", "not_found");
      }
    }

    const body = await storage.getObject(attachment.storageKey);
    return { attachment, body };
  },

  async delete(id: string, userId: string): Promise<void> {
    const attachment = await prisma.emailAttachment.findFirst({
      where: { id, createdByUserId: userId },
    });
    if (!attachment) {
      throw new HttpError(404, "Attachment not found", "not_found");
    }

    if (attachment.emailJobId)
      throw new HttpError(
        409,
        "This attachment is already part of an accepted email and cannot be removed.",
        "attachment_conflict"
      );
    const removed = await prisma.emailAttachment.deleteMany({
      where: { id, createdByUserId: userId, emailJobId: null },
    });
    if (removed.count !== 1)
      throw new HttpError(
        409,
        "This attachment was accepted for sending while you were removing it.",
        "attachment_conflict"
      );
    // Sibling deliveries share this blob. Metadata deletion must never erase it.
    if (
      await prisma.emailAttachment.count({
        where: { storageKey: attachment.storageKey },
      })
    )
      return;
    // Forward drafts can share private original blobs with inbound mail.
    if (
      await prisma.inboundAttachment.count({
        where: { storageKey: attachment.storageKey },
      })
    )
      return;
    // Best-effort blob removal: a storage hiccup must not block clearing the
    // metadata row (an orphaned blob is harmless and reclaimable).
    await storage.deleteObject(attachment.storageKey).catch(() => undefined);
  },

  /**
   * Attach previously-uploaded files to an EmailJob at send time. Scoped to the
   * org and to unlinked rows so an attachment can't be reused across jobs or
   * claimed from another organization.
   */
  async linkToJob(
    attachmentIds: string[] | undefined,
    organizationId: string,
    emailJobId: string,
    db: Prisma.TransactionClient = prisma,
    userId?: string | null
  ): Promise<void> {
    if (!attachmentIds?.length) {
      return;
    }
    const unique = Array.from(new Set(attachmentIds));
    const { count } = await db.emailAttachment.updateMany({
      where: {
        id: { in: unique },
        organizationId,
        emailJobId: null,
        ...(userId ? { createdByUserId: userId } : {}),
      },
      data: { emailJobId },
    });

    // The scoping above silently drops ids that are unknown, already consumed
    // by another job, or owned by a different org. Left unchecked that sends a
    // message with fewer attachments than the caller asked for and reports
    // success — the user only finds out when the recipient tells them. Fail the
    // send instead: an explicit error is recoverable, a silently-missing
    // attachment is not.
    if (count !== unique.length) {
      throw new HttpError(
        400,
        "One or more attachments are unavailable (already sent, unknown, or from another organization)",
        "validation_error"
      );
    }
  },

  /**
   * Copy attachment metadata rows onto another job of the same fanned-out
   * send. A multi-recipient manual send becomes one EmailJob per recipient,
   * but an uploaded EmailAttachment row can only link to a single job — so
   * sibling jobs get their own rows pointing at the same stored blob. The blob
   * itself is not duplicated; only its Postgres metadata is.
   */
  async copyToJob(
    attachmentIds: string[] | undefined,
    organizationId: string,
    emailJobId: string,
    db: Prisma.TransactionClient = prisma,
    userId?: string | null
  ): Promise<void> {
    if (!attachmentIds?.length) {
      return;
    }
    const unique = Array.from(new Set(attachmentIds));
    const rows = await db.emailAttachment.findMany({
      where: {
        id: { in: unique },
        organizationId,
        ...(userId ? { createdByUserId: userId } : {}),
      },
    });
    if (rows.length !== unique.length) {
      throw new HttpError(
        400,
        "One or more attachments are unavailable (unknown or from another organization)",
        "validation_error"
      );
    }
    await db.emailAttachment.createMany({
      data: rows.map((row) => ({
        organizationId: row.organizationId,
        emailJobId,
        filename: row.filename,
        contentType: row.contentType,
        size: row.size,
        storageKey: row.storageKey,
        cid: row.cid,
        createdByUserId: row.createdByUserId,
      })),
    });
  },

  /**
   * Persist inline attachments carried on a transactional send body: blob to
   * object storage, metadata row (with the cid) linked to the job directly —
   * unlike uploads there is no unlinked intermediate state to claim. Runs
   * before the job is enqueued, so the worker never races these writes. The
   * schema already enforced strict base64 and the size cap; the decode here
   * re-measures as defense in depth against a caller that bypassed it.
   */
  async createInlineForJob(
    attachments: InlineAttachmentInput[] | undefined,
    organizationId: string,
    emailJobId: string,
    createdByUserId?: string | null,
    db: Prisma.TransactionClient = prisma
  ): Promise<void> {
    if (!attachments?.length) {
      return;
    }

    for (const inline of attachments) {
      const size = base64DecodedBytes(inline.contentBase64);
      if (size <= 0 || size > INLINE_ATTACHMENT_MAX_BYTES) {
        throw new HttpError(
          400,
          `Inline attachments must be 1–${INLINE_ATTACHMENT_MAX_BYTES} bytes`,
          "attachment_too_large"
        );
      }

      const filename = sanitizeFilename(inline.filename);
      const storageKey = `org/${organizationId}/${randomUUID()}-${filename}`;
      const contentType = inline.contentType ?? "application/octet-stream";

      await storage.putObject({
        key: storageKey,
        body: Buffer.from(inline.contentBase64, "base64"),
        contentType,
      });

      await db.emailAttachment.create({
        data: {
          organizationId,
          emailJobId,
          filename,
          contentType,
          size,
          storageKey,
          cid: inline.cid,
          createdByUserId: createdByUserId ?? undefined,
        },
      });
    }
  },

  /**
   * Load an EmailJob's attachments as Nodemailer-ready payloads (filename +
   * blob + content type) for the synchronous send path. The worker loads them
   * independently for queued sends.
   */
  async loadForJob(emailJobId: string): Promise<EmailAttachment[] | undefined> {
    const rows = await prisma.emailAttachment.findMany({
      where: { emailJobId },
    });
    if (rows.length === 0) {
      return undefined;
    }

    const attachments: EmailAttachment[] = [];
    for (const row of rows) {
      const content = await storage.getObject(row.storageKey);
      attachments.push({
        filename: row.filename,
        content,
        contentType: row.contentType,
        cid: row.cid ?? undefined,
      });
    }
    return attachments;
  },
};
