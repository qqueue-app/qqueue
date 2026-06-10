import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export interface CampaignProcessingJob {
  campaignId: string;
  /**
   * Stable identifier for a single execution of the campaign. Manual/scheduled
   * sends set this explicitly; recurring (job-scheduler) fires omit it and the
   * worker falls back to the BullMQ job id.
   */
  occurrenceKey?: string;
}

export const campaignProcessingQueue = new Queue<CampaignProcessingJob>(
  "campaign-processing",
  {
    connection: redisConnection
  }
);
