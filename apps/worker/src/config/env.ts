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
  TRACKING_SECRET: z.string().min(1)
});

export const env = envSchema.parse(process.env);
