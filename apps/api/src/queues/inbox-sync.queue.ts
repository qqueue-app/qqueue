import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export const inboxSyncQueue = new Queue<{ inboxAccountId: string }>(
  "inbox-sync",
  {
    connection: {
      ...redisConnection,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
  }
);
