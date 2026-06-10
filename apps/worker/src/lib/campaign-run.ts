import { nextCronRun } from "./cron.js";
import { prisma } from "./prisma.js";

/**
 * Settle a campaign run once all of its email jobs have left the active states.
 * Recurring campaigns return to SCHEDULED (awaiting the next fire); one-shot
 * campaigns are marked SENT. A campaign that has since been PAUSED is left
 * untouched so its held jobs can resume later.
 */
export async function settleRunIfComplete(campaignRunId: string | null) {
  if (!campaignRunId) {
    return;
  }

  const activeJobs = await prisma.emailJob.count({
    where: {
      campaignRunId,
      status: { in: ["PENDING", "QUEUED", "PROCESSING"] }
    }
  });

  if (activeJobs !== 0) {
    return;
  }

  const run = await prisma.campaignRun.findUnique({
    where: { id: campaignRunId },
    select: { id: true, campaignId: true, status: true }
  });

  if (!run || run.status !== "SENDING") {
    return;
  }

  await prisma.campaignRun.update({
    where: { id: run.id },
    data: { status: "SENT", completedAt: new Date() }
  });

  const campaign = await prisma.campaign.findUnique({
    where: { id: run.campaignId },
    select: { id: true, status: true, cronExpression: true, timezone: true }
  });

  if (!campaign || campaign.status !== "SENDING") {
    return;
  }

  if (campaign.cronExpression) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "SCHEDULED",
        lastRunAt: new Date(),
        nextRunAt: nextCronRun(campaign.cronExpression, campaign.timezone)
      }
    });
    return;
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "SENT", lastRunAt: new Date() }
  });
}
