import { DelayedError, Worker } from "bullmq";
import { SMTPProvider } from "@qqueue/email-engine";
import { redisConnection } from "../config/redis.js";
import { settleRunIfComplete } from "../lib/campaign-run.js";
import { decryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import type { EmailSendingJob } from "../queues/email-sending.queue.js";

const PAUSE_RETRY_DELAY_MS = 30_000;

function formatFrom(connection: { fromEmail: string; fromName: string | null }) {
  if (!connection.fromName) {
    return connection.fromEmail;
  }

  return `${connection.fromName} <${connection.fromEmail}>`;
}

export function startEmailSendingWorker() {
  return new Worker<EmailSendingJob>(
    "email-sending",
    async (job, token) => {
      const emailJob = await prisma.emailJob.findUnique({
        where: { id: job.data.emailJobId },
        include: { smtpConnection: true, campaign: { select: { status: true } } }
      });

      if (!emailJob || emailJob.status === "CANCELLED") {
        return;
      }

      // Hold sends for paused campaigns: re-check shortly without consuming an
      // attempt, so resuming the campaign lets the job continue automatically.
      if (emailJob.campaign?.status === "PAUSED") {
        await job.moveToDelayed(Date.now() + PAUSE_RETRY_DELAY_MS, token);
        throw new DelayedError();
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

        await settleRunIfComplete(emailJob.campaignRunId);
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
          await settleRunIfComplete(emailJob.campaignRunId);
        }

        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 5
    }
  );
}
