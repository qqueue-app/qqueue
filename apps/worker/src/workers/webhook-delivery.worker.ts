import { createHmac } from "node:crypto";
import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { decryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import type { WebhookDeliveryJob } from "../queues/webhook-delivery.queue.js";

function signPayload(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function startWebhookDeliveryWorker() {
  return new Worker<WebhookDeliveryJob>(
    "webhook-delivery",
    async (job) => {
      const delivery = await prisma.webhookDelivery.findUnique({
        where: { id: job.data.deliveryId },
        include: { endpoint: true }
      });

      if (!delivery || delivery.status === "DELIVERED") {
        return;
      }

      if (!delivery.endpoint.enabled || delivery.endpoint.deletedAt) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "CANCELLED",
            attempts: { increment: 1 },
            error: "Webhook endpoint is disabled"
          }
        });
        return;
      }

      const body = JSON.stringify(delivery.payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const secret = decryptSecret(delivery.endpoint.secretEncrypted);
      const signature = signPayload(secret, timestamp, body);

      try {
        const response = await fetch(delivery.endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "QQueue-Webhooks/1.0",
            "QQueue-Event": delivery.eventName,
            "QQueue-Delivery": delivery.id,
            "QQueue-Timestamp": timestamp,
            "QQueue-Signature": `v1=${signature}`
          },
          body
        });

        if (!response.ok) {
          const message = `Webhook endpoint returned ${response.status}`;
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "FAILED",
              attempts: { increment: 1 },
              responseStatus: response.status,
              error: message,
              nextAttemptAt: new Date(Date.now() + 30_000)
            }
          });
          throw new Error(message);
        }

        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "DELIVERED",
            attempts: { increment: 1 },
            responseStatus: response.status,
            error: null,
            nextAttemptAt: null,
            deliveredAt: new Date()
          }
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Webhook endpoint returned")) {
          throw error;
        }

        const message =
          error instanceof Error ? error.message : "Unknown webhook delivery error";
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "FAILED",
            attempts: { increment: 1 },
            error: message,
            nextAttemptAt: new Date(Date.now() + 30_000)
          }
        });
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 5
    }
  );
}
