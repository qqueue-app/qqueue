import { StorageClient } from "@qqueue/storage";
import { env } from "../config/env.js";

/**
 * Shared object-storage client for email attachments. Blobs live here; metadata
 * lives on the `EmailAttachment` table. The worker has its own client built from
 * the same S3_* settings so it can read blobs at send time.
 */
export const storage = new StorageClient({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE
});
