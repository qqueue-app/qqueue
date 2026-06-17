import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { syncInboxAccounts } from "../lib/inbox-sync.js";
import type { InboxSyncJob } from "../queues/inbox-sync.queue.js";

export function startInboxSyncWorker() {
  return new Worker<InboxSyncJob>(
    "inbox-sync",
    async (job) => {
      await syncInboxAccounts(job.data.inboxAccountId);
    },
    { connection: redisConnection }
  );
}
