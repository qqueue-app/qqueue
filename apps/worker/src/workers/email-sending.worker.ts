import { DelayedError, Worker } from "bullmq";
import {
  SMTPProvider,
  appendUnsubscribeFooter,
  appendUnsubscribeFooterText,
  buildUnsubscribeUrl,
  classifyBounce,
  injectTracking,
  listUnsubscribeHeadersForUrl,
} from "@qqueue/email-engine";
import { BRANDING_FOOTER_MARKER, emailHeadersSchema } from "@qqueue/shared";
import { env } from "../config/env.js";
import { redisConnection } from "../config/redis.js";
import { loadAttachmentsForJob } from "../lib/attachments.js";
import { settleSendGroup } from "../lib/send-group.js";
import { settleRunIfComplete } from "../lib/campaign-run.js";
import { decryptSecret } from "../lib/crypto.js";
import { enqueueLatestWebhookDeliveries } from "../lib/outbound-webhooks.js";
import { prisma } from "../lib/prisma.js";
import {
  addSuppression,
  isSuppressed,
  shouldSuppressBounce,
  suppressedAmong,
} from "../lib/suppression.js";
import { reserveDomainSlot } from "../lib/throttle.js";
import type { EmailSendingJob } from "../queues/email-sending.queue.js";

const PAUSE_RETRY_DELAY_MS = 30_000;

function formatFrom(connection: {
  fromEmail: string;
  fromName: string | null;
}) {
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
          organization: { select: { footerNote: true } },
        },
      });

      if (
        !emailJob ||
        ["CANCELLED", "SENT", "SUPPRESSED", "UNCERTAIN"].includes(
          emailJob.status
        )
      ) {
        return;
      }

      try {
        // A replay after a worker crash cannot establish whether SMTP accepted
        // DATA. Never automatically deliver this message a second time.
        if (emailJob.status === "PROCESSING") {
          await prisma.emailJob.updateMany({
            where: { id: emailJob.id, status: "PROCESSING" },
            data: { status: "UNCERTAIN" },
          });
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
            data: { status: "SUPPRESSED" },
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
          await job.moveToDelayed(
            Date.now() + (slot.retryInMs ?? 1_000),
            token
          );
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
        if (emailJob.origin !== "SYSTEM" && (cc.length > 0 || bcc.length > 0)) {
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
            cc = cc.filter(
              (email) => !suppressedCopies.has(email.toLowerCase())
            );
            bcc = bcc.filter(
              (email) => !suppressedCopies.has(email.toLowerCase())
            );
          }
        }
        const strippedMetadata =
          strippedCc.length > 0 || strippedBcc.length > 0
            ? {
                ...(strippedCc.length > 0 ? { strippedCc } : {}),
                ...(strippedBcc.length > 0 ? { strippedBcc } : {}),
              }
            : {};

        const messageId =
          emailJob.messageId ?? `<${emailJob.id}@qqueue.invalid>`;
        const claimed = await prisma.emailJob.updateMany({
          where: {
            id: emailJob.id,
            status: { in: ["PENDING", "QUEUED", "FAILED"] },
          },
          data: { status: "PROCESSING", messageId },
        });
        if (claimed.count !== 1) return;
        let outcomeRecorded = false;
        let smtpStarted = false;

        try {
          const provider = new SMTPProvider({
            host: emailJob.smtpConnection.host,
            port: emailJob.smtpConnection.port,
            secure: emailJob.smtpConnection.secure,
            auth: {
              user: decryptSecret(emailJob.smtpConnection.usernameEncrypted),
              pass: decryptSecret(emailJob.smtpConnection.passwordEncrypted),
            },
          });

          const attachments = await loadAttachmentsForJob(emailJob.id);

          // Headers are validated at the API boundary and checked again here in
          // case an older or manually inserted job reaches the queue.
          const callerHeaders = emailJob.headers
            ? emailHeadersSchema.parse(emailJob.headers)
            : undefined;
          const oneClickHeader = Object.entries(callerHeaders ?? {}).find(
            ([name]) => name.toLowerCase() === "list-unsubscribe-post"
          );
          const customUnsubscribeUrl = oneClickHeader
            ? /^<(https:\/\/[^<>]+)>$/.exec(
                Object.entries(callerHeaders ?? {}).find(
                  ([name]) => name.toLowerCase() === "list-unsubscribe"
                )?.[1] ?? ""
              )?.[1]
            : undefined;

          // Keep account mail links untouched; track links in other messages.
          const trackedHtml =
            emailJob.origin === "SYSTEM"
              ? (emailJob.html ?? undefined)
              : injectTracking(emailJob.html, {
                  emailJobId: emailJob.id,
                  baseUrl: env.APP_URL,
                  secret: env.TRACKING_SECRET,
                });

          // Bulk mail (campaign fan-out, recurring sends, or a bulk API send)
          // offers a one-click unsubscribe unless disabled on the campaign.
          // Bulk mail includes a visible unsubscribe link as well as headers.
          const unsubscribeUrl =
            emailJob.isBulk && emailJob.unsubscribeEnabled !== false
              ? (customUnsubscribeUrl ??
                buildUnsubscribeUrl(
                  env.APP_URL,
                  emailJob.organizationId,
                  emailJob.toEmail,
                  env.TRACKING_SECRET
                ))
              : undefined;

          // For bulk jobs, QQueue's pair is authoritative unless the caller
          // supplied a complete one-click pair. Strip caller spellings first to
          // avoid case-variant duplicates.
          const otherHeaders = emailJob.isBulk
            ? Object.fromEntries(
                Object.entries(callerHeaders ?? {}).filter(
                  ([name]) =>
                    !["list-unsubscribe", "list-unsubscribe-post"].includes(
                      name.toLowerCase()
                    )
                )
              )
            : callerHeaders;
          const headers = unsubscribeUrl
            ? {
                ...otherHeaders,
                ...listUnsubscribeHeadersForUrl(unsubscribeUrl),
              }
            : otherHeaders;

          const footerOptions = {
            note: emailJob.organization?.footerNote ?? null,
          };
          const html = unsubscribeUrl
            ? appendUnsubscribeFooter(trackedHtml, unsubscribeUrl, {
                note: trackedHtml?.includes(BRANDING_FOOTER_MARKER)
                  ? null
                  : footerOptions.note,
              })
            : trackedHtml;
          const text = unsubscribeUrl
            ? appendUnsubscribeFooterText(emailJob.text, unsubscribeUrl, footerOptions)
            : (emailJob.text ?? undefined);

          smtpStarted = true;
          const result = await provider.send({
            from: formatFrom(emailJob.smtpConnection),
            // Visible headers do not decide SMTP delivery. In particular, never
            // re-deliver to sibling To recipients or leak a Bcc header.
            to:
              emailJob.recipientField || emailJob.visibleTo?.length
                ? emailJob.visibleTo
                : emailJob.toEmail,
            cc:
              emailJob.recipientField || emailJob.visibleTo?.length
                ? emailJob.visibleCc.length
                  ? emailJob.visibleCc
                  : undefined
                : cc.length
                  ? cc
                  : undefined,
            bcc:
              emailJob.recipientField || emailJob.visibleTo?.length
                ? undefined
                : bcc.length
                  ? bcc
                  : undefined,
            envelope:
              emailJob.recipientField || emailJob.visibleTo?.length
                ? {
                    from: emailJob.smtpConnection.fromEmail,
                    to: [emailJob.toEmail, ...cc, ...bcc],
                  }
                : undefined,
            messageId,
            // The account's default Reply-To, unless this send named its own.
            // Resolved here rather than at job creation so it lands on every
            // origin at once — campaign fan-out, recurring runs, transactional
            // and manual sends all reach this one line — and so editing a
            // sending account also corrects jobs already sitting in the queue.
            replyTo:
              emailJob.replyTo ?? emailJob.smtpConnection.replyTo ?? undefined,
            inReplyTo: emailJob.inReplyTo ?? undefined,
            references: emailJob.references.length
              ? emailJob.references
              : undefined,
            subject: emailJob.subject,
            html,
            text,
            headers,
            attachments,
          });

          const accepted = new Set(
            result.accepted.map((email) => email.toLowerCase())
          );
          const rejected = result.rejected.filter(
            (email) => !accepted.has(email.toLowerCase())
          );
          const bounces = rejected.map((email) => {
            const reason =
              result.rejections?.find(
                (entry) => entry.email.toLowerCase() === email.toLowerCase()
              )?.response ?? result.rejectionResponse;
            return {
              email,
              reason,
              bounceType: classifyBounce({ message: reason }),
            };
          });
          const sent = result.accepted.length > 0;
          await prisma.emailJob.update({
            where: { id: emailJob.id },
            data: {
              status: sent ? "SENT" : rejected.length ? "FAILED" : "UNCERTAIN",
              sentAt: sent ? new Date() : null,
              messageId: result.messageId || messageId,
              events: {
                create: [
                  ...(sent
                    ? [
                        {
                          organizationId: emailJob.organizationId,
                          type: "SENT" as const,
                          metadata: {
                            provider: result.provider,
                            messageId: result.messageId,
                            accepted: result.accepted,
                            rejected,
                            ...strippedMetadata,
                          },
                        },
                      ]
                    : []),
                  ...bounces.map((bounce) => ({
                    organizationId: emailJob.organizationId,
                    type: "BOUNCED" as const,
                    metadata: {
                      provider: result.provider,
                      messageId: result.messageId,
                      recipient: bounce.email,
                      accepted: result.accepted,
                      rejected: [bounce.email],
                      bounceType: bounce.bounceType,
                      ...(bounce.reason ? { reason: bounce.reason } : {}),
                      ...strippedMetadata,
                    },
                  })),
                ],
              },
            },
          });
          outcomeRecorded = true;
          for (const bounce of bounces) {
            if (
              await shouldSuppressBounce({
                organizationId: emailJob.organizationId,
                email: bounce.email,
                bounceType: bounce.bounceType,
              })
            ) {
              await prisma.contact.updateMany({
                where: {
                  organizationId: emailJob.organizationId,
                  email: { equals: bounce.email, mode: "insensitive" },
                },
                data: { status: "BOUNCED" },
              });
              await addSuppression({
                organizationId: emailJob.organizationId,
                email: bounce.email,
                reason: "BOUNCE",
                source: emailJob.id,
              });
            }
          }
          if (sent)
            await enqueueLatestWebhookDeliveries({
              organizationId: emailJob.organizationId,
              emailJobId: emailJob.id,
              type: "SENT",
            });
          if (bounces.length)
            await enqueueLatestWebhookDeliveries({
              organizationId: emailJob.organizationId,
              emailJobId: emailJob.id,
              type: "BOUNCED",
            });

          await settleRunIfComplete(emailJob.campaignRunId);
        } catch (error) {
          // A webhook/bookkeeping failure after recording the SMTP outcome must
          // never turn a delivered message back into a sendable queued job.
          if (outcomeRecorded) throw error;
          const failure = error as {
            command?: string;
            responseCode?: number;
            code?: string;
            syscall?: string;
          };
          const definiteRejection =
            typeof failure.responseCode === "number" &&
            failure.responseCode >= 400;
          const safeCommand =
            /^(EHLO|HELO|AUTH|MAIL FROM|RCPT TO|STARTTLS)/i.test(
              failure.command ?? ""
            );
          // Once SMTP may have accepted DATA, even a failed DB write is ambiguous.
          // A stable Message-ID allows reconciliation; it cannot ensure exactly once.
          if (
            smtpStarted &&
            !safeCommand &&
            !definiteRejection &&
            failure.syscall !== "connect" &&
            !["EDNS", "EAUTH", "ENOAUTH", "ECONNREFUSED"].includes(
              failure.code ?? ""
            )
          ) {
            await prisma.emailJob.update({
              where: { id: emailJob.id },
              data: {
                status: "UNCERTAIN",
                events: {
                  create: {
                    organizationId: emailJob.organizationId,
                    type: "FAILED",
                    metadata: {
                      uncertain: true,
                      message:
                        "Delivery could not be confirmed. Check the recipient or mail server before sending again.",
                      error:
                        error instanceof Error
                          ? error.message
                          : "Unknown SMTP outcome",
                    },
                  },
                },
              },
            });
            return;
          }
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
                          attempts: job.attemptsMade + 1,
                        },
                      },
                    },
                  }
                : {}),
            },
          });

          // Both of these follow the event: a send that still has retries left
          // has not failed yet, and firing a `FAILED` webhook for one that then
          // succeeds tells the consumer the opposite of what happened.
          if (isFinalAttempt) {
            await enqueueLatestWebhookDeliveries({
              organizationId: emailJob.organizationId,
              emailJobId: emailJob.id,
              type: "FAILED",
            });

            await settleRunIfComplete(emailJob.campaignRunId);
          }

          throw error;
        }
      } finally {
        await settleSendGroup(emailJob.organizationId, emailJob.sendGroupId);
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );
}
