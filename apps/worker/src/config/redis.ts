import type { ConnectionOptions } from "bullmq";
import { env } from "./env.js";

// Password/TLS are only set when configured so the bundled private container
// keeps working with plain host+port. Must match the API's Redis settings.
export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  ...(env.REDIS_TLS ? { tls: {} } : {})
} satisfies ConnectionOptions;
