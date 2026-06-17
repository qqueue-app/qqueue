import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export interface InboxSyncJob {
  inboxAccountId?: string;
}

export const inboxSyncQueue = new Queue<InboxSyncJob>("inbox-sync", {
  connection: redisConnection,
});
