import { Redis } from "ioredis";
import { redisConnection } from "../config/redis.js";

export const redis = new Redis({
  ...redisConnection,
  maxRetriesPerRequest: 1,
  lazyConnect: true
});
