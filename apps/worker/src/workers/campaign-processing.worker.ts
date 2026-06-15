import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { emailSendingQueue } from "../queues/email-sending.queue.js";
import {
  campaignProcessingQueue,
  type CampaignProcessingJob
} from "../queues/campaign-processing.queue.js";
import { settleRunIfComplete } from "../lib/campaign-run.js";
import { prisma } from "../lib/prisma.js";

function renderVariables(
  value: string | null | undefined,
  variables: Record<string, unknown>
) {
  if (!value) {
    return undefined;
  }

  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const variable = variables[key];
    return variable === undefined || variable === null ? "" : String(variable);
  });
}

function enqueueEmailJobs(emailJobIds: string[]) {
  return emailSendingQueue.addBulk(
    emailJobIds.map((emailJobId) => ({
      name: "send-email",
      data: { emailJobId },
      opts: {
        jobId: `email-${emailJobId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 }
      }
    }))
  );
}

export function startCampaignProcessingWorker() {
  return new Worker<CampaignProcessingJob>(
    "campaign-processing",
    async (job) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: job.data.campaignId },
        include: {
          template: true,
          contactList: {
            include: {
              members: {
                where: { contact: { status: "ACTIVE" } },
                include: { contact: true },
                orderBy: { contact: { createdAt: "asc" } }
              }
            }
          }
        }
      });

      // Cancelled or paused campaigns must not produce sends. (For recurring
      // campaigns, pausing also removes the job scheduler, so no future fires.)
      if (
        !campaign ||
        campaign.status === "CANCELLED" ||
        campaign.status === "PAUSED"
      ) {
        return;
      }

      // Defensive guard for one-shot scheduled jobs that somehow run early.
      if (
        campaign.status === "SCHEDULED" &&
        !campaign.cronExpression &&
        campaign.scheduledAt &&
        campaign.scheduledAt.getTime() > Date.now()
      ) {
        await campaignProcessingQueue.add(
          "process-campaign",
          { campaignId: campaign.id, occurrenceKey: job.data.occurrenceKey },
          {
            delay: campaign.scheduledAt.getTime() - Date.now(),
            jobId: `campaign-${campaign.id}-${campaign.scheduledAt.toISOString()}`
          }
        );
        return;
      }

      if (campaign.status === "SCHEDULED") {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "SENDING" }
        });
      } else if (campaign.status !== "SENDING") {
        return;
      }

      // Each execution is scoped to a CampaignRun keyed by occurrenceKey, so a
      // recurring campaign creates fresh email jobs every fire while retries and
      // crash recovery stay idempotent.
      const occurrenceKey =
        job.data.occurrenceKey ?? job.id ?? String(job.timestamp);

      const run = await prisma.campaignRun.upsert({
        where: {
          campaignId_occurrenceKey: { campaignId: campaign.id, occurrenceKey }
        },
        create: { campaignId: campaign.id, occurrenceKey },
        update: {}
      });

      const existingJobs = await prisma.emailJob.findMany({
        where: { campaignRunId: run.id },
        select: { id: true }
      });

      // Retry/recovery of a fire that already created its jobs: just re-enqueue.
      if (existingJobs.length > 0) {
        await enqueueEmailJobs(existingJobs.map((emailJob) => emailJob.id));
        return;
      }

      if (!campaign.template || !campaign.contactList) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "CANCELLED" }
        });
        throw new Error("Campaign requires a template and contact list");
      }

      const template = campaign.template;

      const smtpConnection = await prisma.sMTPConnection.findFirst({
        where: { organizationId: campaign.organizationId, isDefault: true },
        select: { id: true }
      });

      if (!smtpConnection) {
        throw new Error("Default SMTP connection not found");
      }

      const contacts = campaign.contactList.members.map((member) => member.contact);
      if (contacts.length === 0) {
        // No recipients this run: settle it so a recurring campaign returns to
        // SCHEDULED (and a one-shot is marked SENT).
        await settleRunIfComplete(run.id);
        return;
      }

      const emailJobs = await prisma.$transaction(async (tx) => {
        await tx.emailJob.createMany({
          data: contacts.map((contact) => {
            const variables = {
              email: contact.email,
              firstName: contact.firstName ?? "",
              lastName: contact.lastName ?? ""
            };

            return {
              organizationId: campaign.organizationId,
              smtpConnectionId: smtpConnection.id,
              templateId: campaign.templateId,
              campaignId: campaign.id,
              campaignRunId: run.id,
              origin: "CAMPAIGN" as const,
              toEmail: contact.email,
              subject:
                renderVariables(template.subject, variables) ??
                template.subject,
              html: renderVariables(template.html, variables),
              text: renderVariables(template.text, variables),
              variables,
              status: "QUEUED" as const
            };
          })
        });

        return tx.emailJob.findMany({
          where: { campaignRunId: run.id },
          select: { id: true }
        });
      });

      await enqueueEmailJobs(emailJobs.map((emailJob) => emailJob.id));
    },
    {
      connection: redisConnection,
      concurrency: 2
    }
  );
}
