import { prisma } from "./lib/prisma.js";
import { campaignProcessingQueue } from "./queues/campaign-processing.queue.js";
import { dkimVerificationQueue } from "./queues/dkim-verification.queue.js";
import { emailSendingQueue } from "./queues/email-sending.queue.js";
import { inboxSyncQueue } from "./queues/inbox-sync.queue.js";
import { webhookDeliveryQueue } from "./queues/webhook-delivery.queue.js";
import { env } from "./config/env.js";
import { startCampaignProcessingWorker } from "./workers/campaign-processing.worker.js";
import { startDkimVerificationWorker } from "./workers/dkim-verification.worker.js";
import { startEmailSendingWorker } from "./workers/email-sending.worker.js";
import { startInboxSyncWorker } from "./workers/inbox-sync.worker.js";
import { startWebhookDeliveryWorker } from "./workers/webhook-delivery.worker.js";

async function recoverQueuedWork() {
  const now = new Date();

  const [scheduledOneShots, recurring, emailJobs, webhookDeliveries] =
    await Promise.all([
      // One-shot scheduled campaigns: their delayed job may have been lost (e.g.
      // Redis flush). Re-enqueue with the same occurrenceKey so we never create a
      // second run. SENDING campaigns recover via their QUEUED email jobs below.
      prisma.campaign.findMany({
        where: {
          status: "SCHEDULED",
          cronExpression: null,
          scheduledAt: { not: null },
        },
        select: { id: true, scheduledAt: true },
      }),
      // Recurring campaigns: re-register their job schedulers (idempotent).
      prisma.campaign.findMany({
        where: { status: "SCHEDULED", cronExpression: { not: null } },
        select: { id: true, cronExpression: true, timezone: true },
      }),
      prisma.emailJob.findMany({
        where: { status: "QUEUED" },
        select: { id: true, scheduledAt: true },
      }),
      prisma.webhookDelivery.findMany({
        where: { status: { in: ["PENDING", "FAILED"] } },
        select: { id: true, nextAttemptAt: true },
      }),
    ]);

  if (scheduledOneShots.length > 0) {
    await campaignProcessingQueue.addBulk(
      scheduledOneShots.map((campaign) => {
        const scheduledAt = campaign.scheduledAt as Date;
        return {
          name: "process-campaign",
          data: {
            campaignId: campaign.id,
            occurrenceKey: `scheduled-${scheduledAt.toISOString()}`,
          },
          opts: {
            delay: Math.max(0, scheduledAt.getTime() - now.getTime()),
            jobId: `campaign-${campaign.id}-scheduled-${scheduledAt.toISOString()}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 },
          },
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
        opts: { attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
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
            emailJob.scheduledAt &&
            emailJob.scheduledAt.getTime() > now.getTime()
              ? emailJob.scheduledAt.getTime() - now.getTime()
              : undefined,
          jobId: `email-${emailJob.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 30_000 },
        },
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
          backoff: { type: "exponential", delay: 30_000 },
        },
      }))
    );
  }
}

async function scheduleInboxSync() {
  await inboxSyncQueue.upsertJobScheduler(
    "inbox-sync-active-accounts",
    { every: env.INBOX_SYNC_INTERVAL_SECONDS * 1000 },
    {
      name: "sync-inbox",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
      },
    }
  );
}

// Daily recheck of every managed sending domain's DKIM DNS record. Catches
// records that propagate after the user's first "Verify now", and re-confirms
// previously verified domains. Runs at 03:00 UTC; on-demand verifies are
// enqueued separately by the API.
async function scheduleDkimRecheck() {
  await dkimVerificationQueue.upsertJobScheduler(
    "dkim-daily-recheck",
    { pattern: "0 3 * * *", tz: "UTC" },
    {
      name: "verify-dkim",
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
      },
    }
  );
}

const workers = [
  startEmailSendingWorker(),
  startCampaignProcessingWorker(),
  startWebhookDeliveryWorker(),
  startInboxSyncWorker(),
  startDkimVerificationWorker(),
];

await recoverQueuedWork();
await scheduleInboxSync();
await scheduleDkimRecheck();

for (const worker of workers) {
  worker.on("completed", (job) => {
    console.log(`Completed ${worker.name} job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Failed ${worker.name} job ${job?.id}:`, error);
  });
}

console.log("QQueue workers started.");
