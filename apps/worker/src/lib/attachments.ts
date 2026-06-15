import type { EmailAttachment } from "@qqueue/email-engine";
import { prisma } from "./prisma.js";
import { storage } from "./storage.js";

/**
 * Load an EmailJob's attachments as Nodemailer-ready payloads (filename + blob +
 * content type) for queued sends. Metadata is read from Postgres; the blob is
 * streamed from object storage. Mirrors the API's synchronous-send loader.
 */
export async function loadAttachmentsForJob(
  emailJobId: string
): Promise<EmailAttachment[] | undefined> {
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
