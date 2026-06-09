import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import type { EmailSendingJob } from "../queues/email-sending.queue.js";

export function startEmailSendingWorker() {
  return new Worker<EmailSendingJob>(
    "email-sending",
    async (job) => {
      console.log(`Processing email job ${job.data.emailJobId}`);
      // TODO: Load EmailJob and SMTP connection from the API/database.
      // TODO: Send through the configured EmailProvider.
      // TODO: Add retry policy, backoff, rate limiting, and event recording.
    },
    {
      connection: redisConnection,
      concurrency: 5
    }
  );
}
