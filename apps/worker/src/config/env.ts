import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url) });
config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Single encryption key, or a comma-separated keyring (first entry
  // encrypts, every entry decrypts) for rotation. One of the two must be set;
  // must match the API. See packages/crypto for the envelope format.
  ENCRYPTION_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  ENCRYPTION_KEYS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  // Optional auth/TLS for hosted Redis (e.g. Upstash); must match the API.
  REDIS_PASSWORD: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  REDIS_TLS: z.preprocess(
    (value) => (value === "" || value === undefined ? "false" : value),
    z.enum(["true", "false"]).transform((value) => value === "true")
  ),
  // Absolute public base URL for tracking links; must match the API's APP_URL.
  APP_URL: z.string().url().default("http://localhost:4000"),
  // HMAC secret for signing tracking tokens; must match the API's TRACKING_SECRET.
  TRACKING_SECRET: z.string().min(1),
  // Object storage (S3-compatible) for email attachments; must match the API's
  // S3 settings so the worker can read blobs the API stored at send time.
  S3_ENDPOINT: z.preprocess(
    (value) => {
      if (value === undefined) {
        return "http://localhost:9100";
      }
      if (value === "") {
        return undefined;
      }
      return value;
    },
    z.string().url().optional()
  ),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("qqueue-attachments"),
  S3_ACCESS_KEY_ID: z.string().default("qqueue"),
  S3_SECRET_ACCESS_KEY: z.string().default("qqueue-secret"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  // Auto-suppression defaults used when an org has no SuppressionPolicy row.
  // Must match the API's values. A soft (transient) bounce only suppresses once
  // this many occur within the window; hard bounces suppress immediately.
  SOFT_BOUNCE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  SOFT_BOUNCE_WINDOW_DAYS: z.coerce.number().int().min(1).default(30),
  // Default per-recipient-domain send cap (messages/minute) used when an org has
  // no DomainThrottle row for the domain or a default. Must match the API.
  DEFAULT_DOMAIN_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  // Inbox sync cadence for active read-only IMAP inbox accounts.
  INBOX_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(120),
  INBOX_SYNC_MAX_MESSAGES: z.coerce.number().int().min(1).max(500).default(50),
  // Per-part ceiling for attachments on *received* mail. Separate from
  // ATTACHMENT_MAX_BYTES (which governs what our users may upload) because
  // inbound size is chosen by the sender, not by us: anything larger is
  // skipped so one huge part can't wedge a mailbox sync.
  INBOUND_ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(25 * 1024 * 1024),
  // Web Push (VAPID). Both unset = the worker never pushes; the dashboard also
  // hides the control, since the API reads the same pair. The public key must
  // match the API's or every device's subscription will be rejected as signed
  // by the wrong key.
  VAPID_PUBLIC_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  VAPID_PRIVATE_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  VAPID_SUBJECT: z.string().default("mailto:admin@localhost"),
  // Absolute base URL of the web dashboard, used as the target a notification
  // opens. Must match the API's PUBLIC_APP_URL.
  PUBLIC_APP_URL: z.string().url().default("https://qqueue.app"),
});

const parsed = envSchema.parse(process.env);

// The effective keyring: ENCRYPTION_KEYS wins, ENCRYPTION_KEY is the
// single-key fallback. Must match the API's derivation.
const encryptionKeys = (parsed.ENCRYPTION_KEYS ?? parsed.ENCRYPTION_KEY ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);
if (encryptionKeys.length === 0) {
  throw new Error(
    "Set ENCRYPTION_KEY (or an ENCRYPTION_KEYS keyring) in the environment"
  );
}

export const env = { ...parsed, ENCRYPTION_KEYS: encryptionKeys };
