import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import { campaignProcessingQueue } from "../queues/campaign-processing.queue.js";
import { emailSendingQueue } from "../queues/email-sending.queue.js";
import {
  recurringSendQueue,
  recurringSendSchedulerId,
} from "../queues/recurring-send.queue.js";
import { webhookDeliveryQueue } from "../queues/webhook-delivery.queue.js";

// A job stranded in PROCESSING is one a crashed worker never finished: BullMQ
// only re-runs it while its Redis job still exists, so after a crash + Redis
// loss nothing would ever retry it. The grace period keeps recovery away from
// jobs a live worker is legitimately mid-send on.
const STUCK_PROCESSING_GRACE_MS = 15 * 60 * 1000;

export async function recoverQueuedWork() {
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

  // Jobs stranded in PROCESSING by a crash mid-send (Phase 5). Reset them to
  // QUEUED and re-enqueue: the processor re-reads status before sending (the
  // CANCELLED re-check pattern), so a job that actually completed after this
  // read is not resent — but a crash after SMTP accepted and before the SENT
  // write can still double-send. The grace period keeps that window rare.
  const stuckJobs = await prisma.emailJob.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(now.getTime() - STUCK_PROCESSING_GRACE_MS) },
    },
    select: { id: true },
  });
  if (stuckJobs.length > 0) {
    await prisma.emailJob.updateMany({
      where: { id: { in: stuckJobs.map((job) => job.id) } },
      data: { status: "QUEUED" },
    });
    logger.warn(
      { count: stuckJobs.length },
      "re-queued email jobs stuck in PROCESSING"
    );
    await emailSendingQueue.addBulk(
      stuckJobs.map((job) => ({
        name: "send-email",
        data: { emailJobId: job.id },
        opts: {
          jobId: `email-${job.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 30_000 },
        },
      }))
    );
  }

  // Active recurring compose sends: re-register their job schedulers so a Redis
  // flush doesn't silently stop them. Idempotent, like the campaign loop below.
  const activeRecurringSends = await prisma.recurringSend.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, cronExpression: true, timezone: true },
  });
  for (const send of activeRecurringSends) {
    await recurringSendQueue.upsertJobScheduler(
      recurringSendSchedulerId(send.id),
      { pattern: send.cronExpression, tz: send.timezone },
      {
        name: "process-recurring-send",
        data: { recurringSendId: send.id },
        opts: { attempts: 3, backoff: { type: "exponential", delay: 30_000 } },
      }
    );
  }

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
