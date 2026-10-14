import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import { settleSendGroup } from "./send-group.js";
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

  // A crashed SMTP attempt may already be accepted; never automatically resend.
  const uncertain = await prisma.emailJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(now.getTime() - STUCK_PROCESSING_GRACE_MS) },
    },
    data: { status: "UNCERTAIN" },
  });
  if (uncertain.count)
    logger.warn(
      { count: uncertain.count },
      "SMTP outcomes require reconciliation"
    );

  // A crash after recording SMTP acceptance can leave the logical message in
  // Outbox. Rotate through pending summaries; settling also advances updatedAt
  // so a busy mailbox cannot permanently hide another group's stale summary.
  const pendingGroups = await prisma.emailJob.findMany({
    where: {
      groupPrimary: true,
      sendGroupId: { not: null },
      groupStatus: { in: ["PENDING", "QUEUED", "PROCESSING"] },
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: { organizationId: true, sendGroupId: true },
  });
  for (const group of pendingGroups)
    await settleSendGroup(group.organizationId, group.sendGroupId);

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
