import { Queue } from "bullmq";
import { env } from "../config/env.js";

export interface CampaignProcessingJob {
  campaignId: string;
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
