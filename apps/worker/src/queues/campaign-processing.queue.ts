import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export interface CampaignProcessingJob {
  campaignId: string;
}

export const campaignProcessingQueue = new Queue<CampaignProcessingJob>(
  "campaign-processing",
  {
    connection: redisConnection
  }
);
