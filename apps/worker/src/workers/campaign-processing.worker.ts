import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import type { CampaignProcessingJob } from "../queues/campaign-processing.queue.js";

export function startCampaignProcessingWorker() {
  return new Worker<CampaignProcessingJob>(
    "campaign-processing",
    async (job) => {
      console.log(`Processing campaign ${job.data.campaignId}`);
      // TODO: Expand campaign recipients into EmailJob records.
      // TODO: Enqueue email-sending jobs in batches.
      // TODO: Respect campaign pause/resume state and organization limits.
    },
    {
      connection: redisConnection,
      concurrency: 2
    }
  );
}
