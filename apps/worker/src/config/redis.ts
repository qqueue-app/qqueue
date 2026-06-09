import type { ConnectionOptions } from "bullmq";
import { env } from "./env.js";

export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT
} satisfies ConnectionOptions;
