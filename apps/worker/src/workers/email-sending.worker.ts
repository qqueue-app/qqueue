import { DelayedError, Worker } from "bullmq";
import {
  SMTPProvider,
  appendUnsubscribeFooter,
  appendUnsubscribeFooterText,
  buildUnsubscribeUrl,
  classifyBounce,
  injectTracking,
  listUnsubscribeHeadersForUrl
} from "@qqueue/email-engine";
import { env } from "../config/env.js";
import { redisConnection } from "../config/redis.js";
import { loadAttachmentsForJob } from "../lib/attachments.js";
import { settleRunIfComplete } from "../lib/campaign-run.js";
import { decryptSecret } from "../lib/crypto.js";
import { enqueueLatestWebhookDeliveries } from "../lib/outbound-webhooks.js";
import { prisma } from "../lib/prisma.js";
import {
  addSuppression,
  isSuppressed,
  shouldSuppressBounce,
  suppressedAmong
} from "../lib/suppression.js";
import { reserveDomainSlot } from "../lib/throttle.js";
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
        include: {
          smtpConnection: true,
          campaign: { select: { status: true } },
          // Only the footer note: the rest of the org's branding is applied
          // when the body is rendered, not when it is sent.
          organization: { select: { footerNote: true } }
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
      // without counting it as a failure. SYSTEM mail (password resets,
      // invitations) deliberately bypasses this — a user who unsubscribed from
      // marketing must still receive account mail. The API-side pre-check in
      // transactionalEmailService.send carries the same bypass.
      if (
        emailJob.origin !== "SYSTEM" &&
        (await isSuppressed(emailJob.organizationId, emailJob.toEmail))
      ) {
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

      // CC/BCC recipients get the same suppression protection as the To
      // recipient: strip suppressed copy-addresses instead of failing the whole
      // job (the To recipient still deserves their message). What was stripped
      // is recorded on the outcome event's metadata below. SYSTEM mail skips
      // this along with every other suppression check.
      let cc = emailJob.cc;
      let bcc = emailJob.bcc;
      let strippedCc: string[] = [];
      let strippedBcc: string[] = [];
      if (
        emailJob.origin !== "SYSTEM" &&
        (cc.length > 0 || bcc.length > 0)
      ) {
        const suppressedCopies = await suppressedAmong(
          emailJob.organizationId,
          [...cc, ...bcc]
        );
        if (suppressedCopies.size > 0) {
          strippedCc = cc.filter((email) =>
            suppressedCopies.has(email.toLowerCase())
          );
          strippedBcc = bcc.filter((email) =>
            suppressedCopies.has(email.toLowerCase())
          );
          cc = cc.filter((email) => !suppressedCopies.has(email.toLowerCase()));
          bcc = bcc.filter(
            (email) => !suppressedCopies.has(email.toLowerCase())
          );
        }
      }
      const strippedMetadata =
        strippedCc.length > 0 || strippedBcc.length > 0
          ? {
              ...(strippedCc.length > 0 ? { strippedCc } : {}),
              ...(strippedBcc.length > 0 ? { strippedBcc } : {})
            }
          : {};

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

        // SYSTEM mail keeps its links untouched: rewriting a password-reset or
        // invite URL through the tracking redirect would make account mail look
        // like (and depend on) marketing infrastructure.
        const trackedHtml =
          emailJob.origin === "SYSTEM"
            ? (emailJob.html ?? undefined)
            : injectTracking(emailJob.html, {
                emailJobId: emailJob.id,
                baseUrl: env.APP_URL,
                secret: env.TRACKING_SECRET
              });

        const attachments = await loadAttachmentsForJob(emailJob.id);

        // Bulk mail (campaign fan-out, recurring sends — flagged at job
        // creation) offers a one-click unsubscribe; transactional, one-off
        // manual, and SYSTEM sends do not. One URL serves both the RFC 8058
        // headers and the visible footer, so they cannot drift apart.
        const unsubscribeUrl = emailJob.isBulk
          ? buildUnsubscribeUrl(
              env.APP_URL,
              emailJob.organizationId,
              emailJob.toEmail,
              env.TRACKING_SECRET
            )
          : undefined;

        const headers = unsubscribeUrl
          ? listUnsubscribeHeadersForUrl(unsubscribeUrl)
          : undefined;

        // The footer goes on *after* tracking injection, so the opt-out link is
        // the only one in the message that isn't rewritten through the click
        // redirect. Both helpers no-op when the body already links to the
        // endpoint (a template using {{unsubscribe_url}}) — hence no duplicate.
        const footerOptions = {
          note: emailJob.organization?.footerNote ?? null
        };
        const html = unsubscribeUrl
          ? appendUnsubscribeFooter(trackedHtml, unsubscribeUrl, footerOptions)
          : trackedHtml;
        const text = unsubscribeUrl
          ? appendUnsubscribeFooterText(
              emailJob.text,
              unsubscribeUrl,
              footerOptions
            )
          : (emailJob.text ?? undefined);

        const result = await provider.send({
          from: formatFrom(emailJob.smtpConnection),
          to: emailJob.toEmail,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          // The account's default Reply-To, unless this send named its own.
          // Resolved here rather than at job creation so it lands on every
          // origin at once — campaign fan-out, recurring runs, transactional
          // and manual sends all reach this one line — and so editing a
          // sending account also corrects jobs already sitting in the queue.
          replyTo:
            emailJob.replyTo ?? emailJob.smtpConnection.replyTo ?? undefined,
          inReplyTo: emailJob.inReplyTo ?? undefined,
          references: emailJob.references.length ? emailJob.references : undefined,
          subject: emailJob.subject,
          html, // tracking injected and unsubscribe footer appended above
          text, // same footer, plaintext half
          headers,
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
                      : {}),
                    ...strippedMetadata
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
                // Insensitive: pre-normalization contacts may carry mixed case.
                email: { equals: emailJob.toEmail, mode: "insensitive" }
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
                  rejected: result.rejected,
                  ...strippedMetadata
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

        /*
          The FAILED event is written once, on the attempt that gives up.

          It used to be written on every attempt, so a job that exhausted three
          retries left three FAILED events behind for one failure. The status
          column stayed correct, which is why the deliverability overview never
          showed it — but anything counting failures through events (webhook
          consumers, the Sent timeline) saw one send fail three times. The
          attempt count moves into the metadata so the retry history is not
          lost with the duplicate rows.
        */
        await prisma.emailJob.update({
          where: { id: emailJob.id },
          data: {
            status: isFinalAttempt ? "FAILED" : "QUEUED",
            ...(isFinalAttempt
              ? {
                  events: {
                    create: {
                      organizationId: emailJob.organizationId,
                      type: "FAILED",
                      metadata: {
                        message:
                          error instanceof Error
                            ? error.message
                            : "Unknown send error",
                        attempts: job.attemptsMade + 1
                      }
                    }
                  }
                }
              : {})
          }
        });

        // Both of these follow the event: a send that still has retries left
        // has not failed yet, and firing a `FAILED` webhook for one that then
        // succeeds tells the consumer the opposite of what happened.
        if (isFinalAttempt) {
          await enqueueLatestWebhookDeliveries({
            organizationId: emailJob.organizationId,
            emailJobId: emailJob.id,
            type: "FAILED"
          });

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
