import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url) });
config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  // Absolute public base URL for tracking links; must match the API's APP_URL.
  APP_URL: z.string().url().default("http://localhost:4000"),
  // HMAC secret for signing tracking tokens; must match the API's TRACKING_SECRET.
  TRACKING_SECRET: z.string().min(1),
  // Object storage (S3-compatible) for email attachments; must match the API's
  // S3 settings so the worker can read blobs the API stored at send time.
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("qqueue-attachments"),
  S3_ACCESS_KEY_ID: z.string().default("qqueue"),
  S3_SECRET_ACCESS_KEY: z.string().default("qqueue-secret"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);
