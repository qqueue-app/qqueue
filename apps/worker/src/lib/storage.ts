import { StorageClient } from "@qqueue/storage";
import { env } from "../config/env.js";

/**
 * Object-storage client used by the send worker to fetch attachment blobs (the
 * API stored them at compose/send time). Built from the same S3_* settings as
 * the API client.
 */
export const storage = new StorageClient({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE
});
