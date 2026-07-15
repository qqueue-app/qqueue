import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export interface WebhookDeliveryJob {
  deliveryId: string;
}

export const webhookDeliveryQueue = new Queue<WebhookDeliveryJob>(
  "webhook-delivery",
  {
    connection: redisConnection
  }
);
