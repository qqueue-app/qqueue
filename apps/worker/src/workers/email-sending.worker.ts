import { DelayedError, Worker } from "bullmq";
import {
  SMTPProvider,
  buildListUnsubscribeHeaders,
  classifyBounce,
  injectTracking
} from "@qqueue/email-engine";
import { env } from "../config/env.js";
import { redisConnection } from "../config/redis.js";
import { loadAttachmentsForJob } from "../lib/attachments.js";
import { settleRunIfComplete } from "../lib/campaign-run.js";
import { decryptSecret } from "../lib/crypto.js";
import { enqueueLatestWebhookDeliveries } from "../lib/outbound-webhooks.js";
import { prisma } from "../lib/prisma.js";
import { dkimSignOptionsFor, formatFrom } from "../lib/sender.js";
import {
  addSuppression,
  isSuppressed,
  shouldSuppressBounce
} from "../lib/suppression.js";
import { reserveDomainSlot } from "../lib/throttle.js";
import type { EmailSendingJob } from "../queues/email-sending.queue.js";

const PAUSE_RETRY_DELAY_MS = 30_000;

export function startEmailSendingWorker() {
  return new Worker<EmailSendingJob>(
    "email-sending",
    async (job, token) => {
      const emailJob = await prisma.emailJob.findUnique({
        where: { id: job.data.emailJobId },
        include: {
          smtpConnection: true,
          // The From + DKIM derive from the chosen identity when present.
          senderIdentity: { include: { sendingDomain: true } },
          campaign: { select: { status: true } }
        }
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

      // Defense-in-depth: an address can be suppressed (bounce, complaint,
      // unsubscribe, manual) between enqueue and send. Skip without sending and
      // without counting it as a failure.
      if (await isSuppressed(emailJob.organizationId, emailJob.toEmail)) {
        await prisma.emailJob.update({
          where: { id: emailJob.id },
          data: { status: "SUPPRESSED" }
        });
        await settleRunIfComplete(emailJob.campaignRunId);
        return;
      }

      // Per-domain throttle: if the recipient's domain is over its per-minute
      // cap, re-check after the window without consuming an attempt (same
      // mechanism as the paused-campaign hold above). The job stays QUEUED.
      const slot = await reserveDomainSlot(
        emailJob.organizationId,
        emailJob.toEmail
      );
      if (!slot.allowed) {
        await job.moveToDelayed(Date.now() + (slot.retryInMs ?? 1_000), token);
        throw new DelayedError();
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

        const html = injectTracking(emailJob.html, {
          emailJobId: emailJob.id,
          baseUrl: env.APP_URL,
          secret: env.TRACKING_SECRET
        });

        const attachments = await loadAttachmentsForJob(emailJob.id);

        // Marketing (campaign) mail carries RFC 8058 one-click unsubscribe
        // headers; transactional/manual sends do not.
        const headers =
          emailJob.origin === "CAMPAIGN"
            ? buildListUnsubscribeHeaders(
                env.APP_URL,
                emailJob.organizationId,
                emailJob.toEmail,
                env.TRACKING_SECRET
              )
            : undefined;

        const result = await provider.send({
          // From comes from the sender identity when the job has one; otherwise
          // the SMTP connection's From (legacy). Reply-to falls back to the
          // identity's default. DKIM signs only managed, verified domains.
          from: formatFrom(emailJob.senderIdentity ?? emailJob.smtpConnection),
          to: emailJob.toEmail,
          cc: emailJob.cc.length ? emailJob.cc : undefined,
          bcc: emailJob.bcc.length ? emailJob.bcc : undefined,
          replyTo:
            emailJob.replyTo ?? emailJob.senderIdentity?.replyTo ?? undefined,
          inReplyTo: emailJob.inReplyTo ?? undefined,
          references: emailJob.references.length ? emailJob.references : undefined,
          subject: emailJob.subject,
          html, // tracking already injected above
          text: emailJob.text ?? undefined,
          headers,
          dkim: dkimSignOptionsFor(emailJob.senderIdentity?.sendingDomain),
          attachments
        });

        // The SMTP server rejected the recipient outright: treat as a bounce
        // rather than a successful send.
        if (result.rejected.length > 0) {
          // Classify so a transient (soft) bounce doesn't permanently suppress.
          const bounceType = classifyBounce({
            message: result.rejectionResponse
          });

          await prisma.emailJob.update({
            where: { id: emailJob.id },
            data: {
              status: "FAILED",
              messageId: result.messageId,
              events: {
                create: {
                  organizationId: emailJob.organizationId,
                  type: "BOUNCED",
                  metadata: {
                    provider: result.provider,
                    messageId: result.messageId,
                    rejected: result.rejected,
                    bounceType,
                    ...(result.rejectionResponse
                      ? { reason: result.rejectionResponse }
                      : {})
                  }
                }
              }
            }
          });

          // Hard/block bounces suppress immediately; a soft bounce only after
          // the org's threshold (the just-recorded BOUNCED event is counted).
          if (
            await shouldSuppressBounce({
              organizationId: emailJob.organizationId,
              email: emailJob.toEmail,
              bounceType
            })
          ) {
            await prisma.contact.updateMany({
              where: {
                organizationId: emailJob.organizationId,
                email: emailJob.toEmail
              },
              data: { status: "BOUNCED" }
            });
            await addSuppression({
              organizationId: emailJob.organizationId,
              email: emailJob.toEmail,
              reason: "BOUNCE",
              source: emailJob.id
            });
          }

          await enqueueLatestWebhookDeliveries({
            organizationId: emailJob.organizationId,
            emailJobId: emailJob.id,
            type: "BOUNCED"
          });

          await settleRunIfComplete(emailJob.campaignRunId);
          return;
        }

        await prisma.emailJob.update({
          where: { id: emailJob.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            messageId: result.messageId,
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

        await enqueueLatestWebhookDeliveries({
          organizationId: emailJob.organizationId,
          emailJobId: emailJob.id,
          type: "SENT"
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

        await enqueueLatestWebhookDeliveries({
          organizationId: emailJob.organizationId,
          emailJobId: emailJob.id,
          type: "FAILED"
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
