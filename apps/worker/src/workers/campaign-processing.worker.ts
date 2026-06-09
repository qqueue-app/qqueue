import { Worker } from "bullmq";
import { redisConnection } from "../config/redis.js";
import { emailSendingQueue } from "../queues/email-sending.queue.js";
import {
  campaignProcessingQueue,
  type CampaignProcessingJob
} from "../queues/campaign-processing.queue.js";
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
              contacts: {
                where: { status: "ACTIVE" },
                orderBy: { createdAt: "asc" }
              }
            }
          },
          emailJobs: { select: { id: true } }
        }
      });

      if (!campaign || campaign.status === "CANCELLED") {
        return;
      }

      if (
        campaign.status === "SCHEDULED" &&
        campaign.scheduledAt &&
        campaign.scheduledAt.getTime() > Date.now()
      ) {
        await campaignProcessingQueue.add(
          "process-campaign",
          { campaignId: campaign.id },
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
      }

      if (campaign.status !== "SENDING" && campaign.status !== "SCHEDULED") {
        return;
      }

      if (campaign.emailJobs.length > 0) {
        await emailSendingQueue.addBulk(
          campaign.emailJobs.map((emailJob) => ({
            name: "send-email",
            data: { emailJobId: emailJob.id },
            opts: {
              jobId: `email-${emailJob.id}`,
              attempts: 3,
              backoff: { type: "exponential", delay: 30_000 }
            }
          }))
        );
        return;
      }

      if (!campaign.template || !campaign.contactList) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "CANCELLED" }
        });
        throw new Error("Campaign requires a template and contact list");
      }

      const smtpConnection = await prisma.sMTPConnection.findFirst({
        where: { organizationId: campaign.organizationId, isDefault: true },
        select: { id: true }
      });

      if (!smtpConnection) {
        throw new Error("Default SMTP connection not found");
      }

      const contacts = campaign.contactList.contacts;
      if (contacts.length === 0) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "SENT" }
        });
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
              toEmail: contact.email,
              subject: renderVariables(campaign.subject, variables) ?? campaign.subject,
              html: renderVariables(campaign.template?.html, variables),
              text: renderVariables(campaign.template?.text, variables),
              variables,
              status: "QUEUED" as const
            };
          })
        });

        return tx.emailJob.findMany({
          where: { campaignId: campaign.id },
          select: { id: true }
        });
      });

      await emailSendingQueue.addBulk(
        emailJobs.map((emailJob) => ({
          name: "send-email",
          data: { emailJobId: emailJob.id },
          opts: {
            jobId: `email-${emailJob.id}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 30_000 }
          }
        }))
      );
      // TODO: Respect campaign pause/resume state and organization limits.
    },
    {
      connection: redisConnection,
      concurrency: 2
    }
  );
}
