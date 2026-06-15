import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { EmailAttachment } from "@qqueue/email-engine";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
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
  const base = basename(name).replace(/[^\w.\- ]+/g, "_").trim();
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
    size: attachment.size
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

    // A draft id is only honored when it belongs to the same user + org.
    let emailDraftId: string | undefined;
    if (input.emailDraftId) {
      const draft = await prisma.emailDraft.findFirst({
        where: {
          id: input.emailDraftId,
          organizationId: input.organizationId,
          createdByUserId: input.userId
        },
        select: { id: true }
      });
      emailDraftId = draft?.id;
    }

    const filename = sanitizeFilename(input.filename);
    const storageKey = `org/${input.organizationId}/${randomUUID()}-${filename}`;

    await storage.putObject({
      key: storageKey,
      body: input.buffer,
      contentType: input.contentType
    });

    const attachment = await prisma.emailAttachment.create({
      data: {
        organizationId: input.organizationId,
        emailDraftId,
        filename,
        contentType: input.contentType,
        size: input.size,
        storageKey,
        createdByUserId: input.userId
      }
    });

    return toMetadata(attachment);
  },

  /**
   * Fetch an attachment (metadata + blob) for download. Scoped to the uploading
   * user, mirroring the personal scoping of drafts.
   */
  async download(id: string, userId: string) {
    const attachment = await prisma.emailAttachment.findFirst({
      where: { id, createdByUserId: userId }
    });
    if (!attachment) {
      throw new HttpError(404, "Attachment not found", "not_found");
    }

    const body = await storage.getObject(attachment.storageKey);
    return { attachment, body };
  },

  async delete(id: string, userId: string): Promise<void> {
    const attachment = await prisma.emailAttachment.findFirst({
      where: { id, createdByUserId: userId }
    });
    if (!attachment) {
      throw new HttpError(404, "Attachment not found", "not_found");
    }

    // Best-effort blob removal: a storage hiccup must not block clearing the
    // metadata row (an orphaned blob is harmless and reclaimable).
    await storage.deleteObject(attachment.storageKey).catch(() => undefined);
    await prisma.emailAttachment.delete({ where: { id: attachment.id } });
  },

  /**
   * Attach previously-uploaded files to an EmailJob at send time. Scoped to the
   * org and to unlinked rows so an attachment can't be reused across jobs or
   * claimed from another organization.
   */
  async linkToJob(
    attachmentIds: string[] | undefined,
    organizationId: string,
    emailJobId: string
  ): Promise<void> {
    if (!attachmentIds?.length) {
      return;
    }
    await prisma.emailAttachment.updateMany({
      where: { id: { in: attachmentIds }, organizationId, emailJobId: null },
      data: { emailJobId }
    });
  },

  /**
   * Load an EmailJob's attachments as Nodemailer-ready payloads (filename +
   * blob + content type) for the synchronous send path. The worker loads them
   * independently for queued sends.
   */
  async loadForJob(emailJobId: string): Promise<EmailAttachment[] | undefined> {
    const rows = await prisma.emailAttachment.findMany({
      where: { emailJobId }
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
        contentType: row.contentType
      });
    }
    return attachments;
  }
};
