import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url) });
config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  WEB_ORIGIN: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  // Absolute public base URL used to build open/click tracking links that land
  // back on this API. In production this is `https://<DOMAIN>`.
  APP_URL: z.string().url().default("http://localhost:4000"),
  // Public base URL of the web dashboard, used to build user-facing links such
  // as password reset links. Defaults to the hosted dashboard domain.
  PUBLIC_APP_URL: z.string().url().default("https://qqueue.app"),
  // HMAC secret for signing/verifying tracking tokens. Must match in the worker.
  TRACKING_SECRET: z.string().min(1),
  // Shared secret authenticating inbound ESP bounce/complaint webhooks. When
  // unset the webhook endpoint rejects every request.
  WEBHOOK_SECRET: z.string().min(1).optional(),
  // Object storage (S3-compatible) for email attachments. Defaults target the
  // bundled MinIO container for self-host; point them at any S3 provider for
  // managed deployments. `S3_FORCE_PATH_STYLE` must stay true for MinIO.
  S3_ENDPOINT: z.string().url().default("http://localhost:9100"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("qqueue-attachments"),
  S3_ACCESS_KEY_ID: z.string().default("qqueue"),
  S3_SECRET_ACCESS_KEY: z.string().default("qqueue-secret"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  // Per-attachment size ceiling in bytes (default 10 MB).
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
  // Auto-suppression defaults used when an org has no SuppressionPolicy row.
  // A soft (transient) bounce only suppresses once this many occur within the
  // window; hard bounces and complaints always suppress immediately.
  SOFT_BOUNCE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  SOFT_BOUNCE_WINDOW_DAYS: z.coerce.number().int().min(1).default(30),
  // Default per-recipient-domain send cap (messages/minute) used when an org has
  // no DomainThrottle row for the domain or a default. Must match the worker.
  DEFAULT_DOMAIN_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(60)
});

export const env = envSchema.parse(process.env);
