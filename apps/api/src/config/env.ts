import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url) });
config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  // Optional auth/TLS for hosted Redis (e.g. Upstash). Blank = no auth, no TLS
  // (the bundled private container).
  REDIS_PASSWORD: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  REDIS_TLS: z.preprocess(
    (value) => (value === "" || value === undefined ? "false" : value),
    z.enum(["true", "false"]).transform((value) => value === "true")
  ),
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
  // The inbound ESP webhook (POST /api/v1/webhooks/email-events) is disabled
  // by default: it authenticates with one instance-wide shared secret and its
  // messageId lookup is not org-scoped, so it only belongs on instances that
  // actually relay through an ESP that posts normalized events. QQueue detects
  // bounces on its own (SMTP rejections + DSN parsing in inbox sync).
  INBOUND_ESP_WEBHOOK_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Shared secret authenticating inbound ESP bounce/complaint webhooks. Only
  // read when INBOUND_ESP_WEBHOOK_ENABLED=true; when unset the endpoint
  // rejects every request.
  WEBHOOK_SECRET: z.string().min(1).optional(),
  // How many reverse-proxy hops to trust for client IPs (Express
  // `trust proxy`). The bundled deployment fronts the API with Caddy, so the
  // default is 1; set 0 when the API is exposed directly, or higher when
  // additional proxies (nginx, a CDN) sit in front. IP-keyed rate limits key
  // on the wrong address when this is wrong.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  // Echo the raw password-reset token in the API response. Explicit opt-in for
  // local development without SMTP; never enable on a real instance — anyone
  // who can request a reset for an email could take over that account.
  DEV_ECHO_RESET_TOKEN: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Object storage (S3-compatible) for email attachments. Defaults target the
  // bundled MinIO container for self-host; point them at any S3 provider for
  // managed deployments. `S3_FORCE_PATH_STYLE` must stay true for MinIO.
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
  // Per-attachment size ceiling in bytes (default 10 MB).
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
  // Auto-suppression defaults used when an org has no SuppressionPolicy row.
  // A soft (transient) bounce only suppresses once this many occur within the
  // window; hard bounces and complaints always suppress immediately.
  SOFT_BOUNCE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  SOFT_BOUNCE_WINDOW_DAYS: z.coerce.number().int().min(1).default(30),
  // Default per-recipient-domain send cap (messages/minute) used when an org has
  // no DomainThrottle row for the domain or a default. Must match the worker.
  DEFAULT_DOMAIN_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  // Mailcow provisioning (Phase 4). Both unset = the feature is off and the
  // Mailboxes provisioning endpoints answer 404. The API key needs mailbox
  // read/write access in Mailcow (Admin -> API).
  MAILCOW_API_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional()
  ),
  MAILCOW_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  // Where provisioned mailboxes speak SMTP/IMAP. Defaults to the Mailcow
  // hostname (from MAILCOW_API_URL) on the implicit-TLS ports.
  MAILCOW_MAIL_HOST: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  MAILCOW_SMTP_PORT: z.coerce.number().int().positive().default(465),
  MAILCOW_IMAP_PORT: z.coerce.number().int().positive().default(993),
});

export const env = envSchema.parse(process.env);
