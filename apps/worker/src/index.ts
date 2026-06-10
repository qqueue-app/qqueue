import { prisma } from "./lib/prisma.js";
import { campaignProcessingQueue } from "./queues/campaign-processing.queue.js";
import { emailSendingQueue } from "./queues/email-sending.queue.js";
import { webhookDeliveryQueue } from "./queues/webhook-delivery.queue.js";
import { startCampaignProcessingWorker } from "./workers/campaign-processing.worker.js";
import { startEmailSendingWorker } from "./workers/email-sending.worker.js";
import { startWebhookDeliveryWorker } from "./workers/webhook-delivery.worker.js";

async function recoverQueuedWork() {
  const now = new Date();

  const [scheduledOneShots, recurring, emailJobs, webhookDeliveries] =
    await Promise.all([
    // One-shot scheduled campaigns: their delayed job may have been lost (e.g.
    // Redis flush). Re-enqueue with the same occurrenceKey so we never create a
    // second run. SENDING campaigns recover via their QUEUED email jobs below.
    prisma.campaign.findMany({
      where: { status: "SCHEDULED", cronExpression: null, scheduledAt: { not: null } },
      select: { id: true, scheduledAt: true }
    }),
    // Recurring campaigns: re-register their job schedulers (idempotent).
    prisma.campaign.findMany({
      where: { status: "SCHEDULED", cronExpression: { not: null } },
      select: { id: true, cronExpression: true, timezone: true }
    }),
      prisma.emailJob.findMany({
        where: { status: "QUEUED" },
        select: { id: true, scheduledAt: true }
      }),
      prisma.webhookDelivery.findMany({
        where: { status: { in: ["PENDING", "FAILED"] } },
        select: { id: true, nextAttemptAt: true }
      })
    ]);

  if (scheduledOneShots.length > 0) {
    await campaignProcessingQueue.addBulk(
      scheduledOneShots.map((campaign) => {
        const scheduledAt = campaign.scheduledAt as Date;
        return {
          name: "process-campaign",
          data: {
            campaignId: campaign.id,
            occurrenceKey: `scheduled-${scheduledAt.toISOString()}`
          },
          opts: {
            delay: Math.max(0, scheduledAt.getTime() - now.getTime()),
            jobId: `campaign-${campaign.id}-scheduled-${scheduledAt.toISOString()}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 }
          }
        };
      })
    );
  }

  for (const campaign of recurring) {
    if (!campaign.cronExpression) {
      continue;
    }
    await campaignProcessingQueue.upsertJobScheduler(
      `campaign-recurring-${campaign.id}`,
      { pattern: campaign.cronExpression, tz: campaign.timezone ?? "UTC" },
      {
        name: "process-campaign",
        data: { campaignId: campaign.id },
        opts: { attempts: 3, backoff: { type: "exponential", delay: 30_000 } }
      }
    );
  }

  if (emailJobs.length > 0) {
    await emailSendingQueue.addBulk(
      emailJobs.map((emailJob) => ({
        name: "send-email",
        data: { emailJobId: emailJob.id },
        opts: {
          // Preserve a future "send later" time across restarts.
          delay:
            emailJob.scheduledAt && emailJob.scheduledAt.getTime() > now.getTime()
              ? emailJob.scheduledAt.getTime() - now.getTime()
              : undefined,
          jobId: `email-${emailJob.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 30_000 }
        }
      }))
    );
  }

  if (webhookDeliveries.length > 0) {
    await webhookDeliveryQueue.addBulk(
      webhookDeliveries.map((delivery) => ({
        name: "deliver-webhook",
        data: { deliveryId: delivery.id },
        opts: {
          delay:
            delivery.nextAttemptAt &&
            delivery.nextAttemptAt.getTime() > now.getTime()
              ? delivery.nextAttemptAt.getTime() - now.getTime()
              : undefined,
          jobId: `webhook-${delivery.id}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 }
        }
      }))
    );
  }
}

const workers = [
  startEmailSendingWorker(),
  startCampaignProcessingWorker(),
  startWebhookDeliveryWorker()
];

await recoverQueuedWork();

for (const worker of workers) {
  worker.on("completed", (job) => {
    console.log(`Completed ${worker.name} job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Failed ${worker.name} job ${job?.id}:`, error);
  });
}

console.log("QQueue workers started.");
