import type { ConnectionOptions } from "bullmq";
import { env } from "./env.js";

// Shared Redis connection options for BullMQ queues and the raw ioredis
// client. Password/TLS are only set when configured so the bundled private
// container keeps working with plain host+port.
export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  ...(env.REDIS_TLS ? { tls: {} } : {})
} satisfies ConnectionOptions;
