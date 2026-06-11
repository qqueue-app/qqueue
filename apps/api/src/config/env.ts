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
  WEBHOOK_SECRET: z.string().min(1).optional()
});

export const env = envSchema.parse(process.env);
