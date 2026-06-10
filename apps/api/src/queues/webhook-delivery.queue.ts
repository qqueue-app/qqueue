import { Queue } from "bullmq";
import { env } from "../config/env.js";

export interface WebhookDeliveryJob {
  deliveryId: string;
}

export const webhookDeliveryQueue = new Queue<WebhookDeliveryJob>(
  "webhook-delivery",
  {
    connection: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT
    }
  }
);
