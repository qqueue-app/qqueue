import { Queue } from "bullmq";
import { env } from "../config/env.js";

export interface CampaignProcessingJob {
  campaignId: string;
  /**
   * Stable identifier for a single execution of the campaign. Manual/scheduled
   * sends set this explicitly; recurring (job-scheduler) fires omit it and the
   * worker falls back to the BullMQ job id.
   */
  occurrenceKey?: string;
  /**
   * When "decide", this job runs the A/B winner selection for the run instead of
   * fanning out recipients. Scheduled with a delay after the test fraction sends.
   */
  phase?: "decide";
}

export const campaignProcessingQueue = new Queue<CampaignProcessingJob>(
  "campaign-processing",
  {
    connection: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT
    }
  }
);
