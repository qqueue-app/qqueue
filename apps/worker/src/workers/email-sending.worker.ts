import { Worker } from "bullmq";
import { SMTPProvider } from "@qqueue/email-engine";
import { redisConnection } from "../config/redis.js";
import { decryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import type { EmailSendingJob } from "../queues/email-sending.queue.js";

function formatFrom(connection: { fromEmail: string; fromName: string | null }) {
  if (!connection.fromName) {
    return connection.fromEmail;
  }

  return `${connection.fromName} <${connection.fromEmail}>`;
}

async function settleCampaignIfComplete(campaignId: string | null) {
  if (!campaignId) {
    return;
  }

  const activeJobs = await prisma.emailJob.count({
    where: {
      campaignId,
      status: { in: ["PENDING", "QUEUED", "PROCESSING"] }
    }
  });

  if (activeJobs !== 0) {
    return;
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "SENT" }
  });
}

export function startEmailSendingWorker() {
  return new Worker<EmailSendingJob>(
    "email-sending",
    async (job) => {
      const emailJob = await prisma.emailJob.findUnique({
        where: { id: job.data.emailJobId },
        include: { smtpConnection: true }
      });

      if (!emailJob || emailJob.status === "CANCELLED") {
        return;
      }

      if (!emailJob.smtpConnection) {
        throw new Error("Email job requires an SMTP connection");
      }

      await prisma.emailJob.update({
        where: { id: emailJob.id },
        data: { status: "PROCESSING" }
      });

      try {
        const provider = new SMTPProvider({
          host: emailJob.smtpConnection.host,
          port: emailJob.smtpConnection.port,
          secure: emailJob.smtpConnection.secure,
          auth: {
            user: decryptSecret(emailJob.smtpConnection.usernameEncrypted),
            pass: decryptSecret(emailJob.smtpConnection.passwordEncrypted)
          }
        });

        const result = await provider.send({
          from: formatFrom(emailJob.smtpConnection),
          to: emailJob.toEmail,
          subject: emailJob.subject,
          html: emailJob.html ?? undefined,
          text: emailJob.text ?? undefined
        });

        await prisma.emailJob.update({
          where: { id: emailJob.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            events: {
              create: {
                organizationId: emailJob.organizationId,
                type: "SENT",
                metadata: {
                  provider: result.provider,
                  messageId: result.messageId,
                  accepted: result.accepted,
                  rejected: result.rejected
                }
              }
            }
          }
        });

        await settleCampaignIfComplete(emailJob.campaignId);
      } catch (error) {
        const isFinalAttempt =
          job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

        await prisma.emailJob.update({
          where: { id: emailJob.id },
          data: {
            status: isFinalAttempt ? "FAILED" : "QUEUED",
            events: {
              create: {
                organizationId: emailJob.organizationId,
                type: "FAILED",
                metadata: {
                  message:
                    error instanceof Error ? error.message : "Unknown send error"
                }
              }
            }
          }
        });

        if (isFinalAttempt) {
          await settleCampaignIfComplete(emailJob.campaignId);
        }

        throw error;
      }
      // TODO: Add retry policy, backoff, rate limiting, and event recording.
    },
    {
      connection: redisConnection,
      concurrency: 5
    }
  );
}
