import type { ParsedMail } from "mailparser";
import { type BounceType, classifyBounce } from "@qqueue/email-engine";
import { enqueueLatestWebhookDeliveries } from "./outbound-webhooks.js";
import { prisma } from "./prisma.js";
import { addSuppression, shouldSuppressBounce } from "./suppression.js";

/**
 * Delivery Status Notification (RFC 3464) handling for inbox sync.
 *
 * The send worker only sees bounces the SMTP server rejects during the
 * conversation. A receiving server that accepts the message and bounces it
 * later mails a DSN back to the sender — which lands in the synced inbox.
 * This module recognizes those messages, extracts what failed and why, and
 * feeds the existing bounce machinery (BOUNCED event, FAILED status,
 * auto-suppression) so async bounces count exactly like synchronous ones.
 *
 * Parsing is deliberately defensive: real-world DSNs are messy, and a
 * malformed one must degrade to "store as a normal inbound message", never
 * crash the sync loop.
 */

/** One per-recipient block of a DSN's machine-readable part. */
export interface DsnRecipientReport {
  /** Final-Recipient address, lowercased. */
  recipient: string;
  /** RFC 3464 Action field, lowercased. Only "failed" feeds bounce handling. */
  action: string;
  /** Enhanced status code like "5.1.1", when present. */
  status?: string;
  /** Free-text Diagnostic-Code (unfolded), when present. */
  diagnosticCode?: string;
}

export interface ParsedDsn {
  recipients: DsnRecipientReport[];
  /** Message-ID of the returned original, from its message/rfc822 part. */
  originalMessageId?: string;
  /** Which strategy produced `recipients`. */
  parsedVia: "delivery-status" | "body-scan";
}

/** How a DSN was matched back to the EmailJob it reports on. */
export type DsnCorrelation =
  | "in-reply-to"
  | "original-message-id"
  | "recipient-recency";

const DAEMON_FROM = /^(mailer-daemon|postmaster)@/i;

// mailparser returns structured header values ({ value, params }) for
// content-type; everything here is optional-chained because tests and odd
// senders can produce sparse objects.
function contentTypeOf(mail: ParsedMail): {
  value?: string;
  params?: Record<string, string>;
} {
  const header = mail.headers?.get?.("content-type");
  if (header && typeof header === "object" && "value" in header) {
    return header as { value?: string; params?: Record<string, string> };
  }
  if (typeof header === "string") {
    return { value: header };
  }
  return {};
}

function isDeliveryStatusReport(mail: ParsedMail): boolean {
  const contentType = contentTypeOf(mail);
  return (
    contentType.value?.toLowerCase() === "multipart/report" &&
    contentType.params?.["report-type"]?.toLowerCase() === "delivery-status"
  );
}

function fromDaemon(mail: ParsedMail): boolean {
  const address = mail.from?.value?.[0]?.address ?? "";
  return DAEMON_FROM.test(address);
}

function isAutoReplied(mail: ParsedMail): boolean {
  const header = mail.headers?.get?.("auto-submitted");
  return typeof header === "string" && /auto-replied/i.test(header);
}

/**
 * The machine-readable text to scan for RFC 3464 fields. mailparser folds a
 * message/delivery-status part into `mail.text` rather than exposing it as an
 * attachment, so the body text is the primary source; an attachment with that
 * content type (some parsers/senders attach it) takes precedence when present.
 */
function deliveryStatusText(mail: ParsedMail): string {
  const part = mail.attachments?.find(
    (attachment) =>
      attachment.contentType?.toLowerCase() === "message/delivery-status"
  );
  if (part?.content) {
    return part.content.toString("utf8");
  }
  return mail.text ?? "";
}

/** Unfold RFC 822 continuation lines so folded Diagnostic-Codes read whole. */
function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]+/g, " ");
}

function fieldValue(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "im"));
  return match?.[1]?.trim() || undefined;
}

/** Strip the RFC 3464 address-type prefix: "rfc822; bob@x.com" -> address. */
function parseFinalRecipient(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutType = value.replace(/^[\w-]+\s*;\s*/, "").trim();
  const match = withoutType.match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/);
  return match?.[0]?.toLowerCase();
}

/** Parse the per-recipient blocks of a delivery-status body. */
function parseRecipientReports(text: string): DsnRecipientReport[] {
  const unfolded = unfold(text);
  const reports: DsnRecipientReport[] = [];

  for (const block of unfolded.split(/\r?\n\s*\r?\n/)) {
    const recipient = parseFinalRecipient(
      fieldValue(block, "Final-Recipient") ??
        fieldValue(block, "Original-Recipient")
    );
    if (!recipient) {
      continue;
    }
    reports.push({
      recipient,
      // A block with a recipient but no Action is treated as failed: senders
      // that omit Action are reporting a failure, and unknown-as-failure
      // matches classifyBounce's conservative default.
      action: fieldValue(block, "Action")?.toLowerCase() ?? "failed",
      status: fieldValue(block, "Status")?.match(
        /\b([245]\.\d{1,3}\.\d{1,3})\b/
      )?.[1],
      diagnosticCode: fieldValue(block, "Diagnostic-Code"),
    });
  }

  return reports;
}

const DELAYED_NOTICE =
  /delivery (?:is |has been |was )?delayed|delayed delivery|delivery incomplete|will (?:keep|continue) (?:re)?trying|has not (?:yet )?been delivered yet|delivery will be attempted/i;

/**
 * Last-ditch parse when a bounce-shaped message carries no parseable
 * delivery-status fields: find an SMTP status code plus a recipient address in
 * the body. Skips messages that read as delay notices — without an Action
 * field, "still trying" must not be recorded as a failure.
 */
function scanBodyForBounce(
  mail: ParsedMail,
  excludeAddresses: Set<string>
): DsnRecipientReport[] {
  const text = `${mail.subject ?? ""}\n${mail.text ?? ""}`;
  if (DELAYED_NOTICE.test(text)) {
    return [];
  }

  const status = text.match(/\b([45]\.\d{1,3}\.\d{1,3})\b/)?.[1];
  const basicCode = text.match(/(?:^|\s)([45]\d{2})(?:\s|$|-)/m)?.[1];
  if (!status && !basicCode) {
    return [];
  }

  const recipient = Array.from(
    text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g),
    (match) => match[0].toLowerCase()
  ).find(
    (address) => !excludeAddresses.has(address) && !DAEMON_FROM.test(address)
  );
  if (!recipient) {
    return [];
  }

  return [
    {
      recipient,
      action: "failed",
      status,
      // The line the code appeared on is the best free-text reason available.
      diagnosticCode: text
        .split(/\r?\n/)
        .find(
          (line) =>
            (status && line.includes(status)) ||
            (basicCode && line.includes(basicCode))
        )
        ?.trim(),
    },
  ];
}

/** Pull the original send's Message-ID out of the returned message part. */
function originalMessageIdOf(mail: ParsedMail): string | undefined {
  const part = mail.attachments?.find((attachment) => {
    const type = attachment.contentType?.toLowerCase();
    return type === "message/rfc822" || type === "text/rfc822-headers";
  });
  if (!part?.content) {
    return undefined;
  }
  // Headers live at the top of the part; 64KB is far more than any header
  // block and keeps a huge returned original from being scanned end to end.
  const head = part.content.toString("utf8", 0, 64 * 1024);
  return unfold(head).match(/^Message-ID:[ \t]*(<[^>]+>)/im)?.[1];
}

/**
 * Recognize and parse a DSN. Returns null for ordinary mail — including
 * bounce-shaped mail we could not extract a recipient from, which callers
 * store as a normal message (never crash sync over a weird bounce).
 *
 * A message is a candidate when its content type is multipart/report with
 * report-type=delivery-status, its From is mailer-daemon@/postmaster@, or it
 * is Auto-Submitted: auto-replied with parseable delivery-status fields.
 */
export function parseDsn(
  mail: ParsedMail,
  options: { excludeAddresses?: string[] } = {}
): ParsedDsn | null {
  const structuredReport = isDeliveryStatusReport(mail);
  const daemonSender = fromDaemon(mail);
  const autoReplied = isAutoReplied(mail);
  if (!structuredReport && !daemonSender && !autoReplied) {
    return null;
  }

  const recipients = parseRecipientReports(deliveryStatusText(mail));
  if (recipients.length > 0) {
    return {
      recipients,
      originalMessageId: originalMessageIdOf(mail),
      parsedVia: "delivery-status",
    };
  }

  // Auto-Submitted alone (vacation responders, read receipts) is not evidence
  // of a bounce — only fall through to the body scan for messages that look
  // like reports or come from the mail system itself.
  if (!structuredReport && !daemonSender) {
    return null;
  }

  const exclude = new Set(
    (options.excludeAddresses ?? [])
      .map((address) => address.toLowerCase())
      .filter(Boolean)
  );
  const scanned = scanBodyForBounce(mail, exclude);
  if (scanned.length === 0) {
    return null;
  }
  return {
    recipients: scanned,
    originalMessageId: originalMessageIdOf(mail),
    parsedVia: "body-scan",
  };
}

const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function correlateEmailJob(input: {
  organizationId: string;
  recipient: string;
  threadEmailJobId: string | null;
  originalMessageId?: string;
}): Promise<{
  job: { id: string; status: string; campaignRunId: string | null };
  method: DsnCorrelation;
} | null> {
  const select = { id: true, status: true, campaignRunId: true } as const;

  // (a) The DSN's In-Reply-To/References matched an outbound messageId — the
  // inbox sync's normal thread anchoring already found this job.
  if (input.threadEmailJobId) {
    const job = await prisma.emailJob.findUnique({
      where: { id: input.threadEmailJobId },
      select,
    });
    if (job) {
      return { job, method: "in-reply-to" };
    }
  }

  // (b) The returned original's own Message-ID.
  if (input.originalMessageId) {
    const job = await prisma.emailJob.findFirst({
      where: {
        organizationId: input.organizationId,
        messageId: input.originalMessageId,
      },
      select,
    });
    if (job) {
      return { job, method: "original-message-id" };
    }
  }

  // (c) Most recent SENT job to the failed address within the last 7 days.
  const job = await prisma.emailJob.findFirst({
    where: {
      organizationId: input.organizationId,
      toEmail: input.recipient,
      status: "SENT",
      sentAt: { gte: new Date(Date.now() - RECENCY_WINDOW_MS) },
    },
    orderBy: { sentAt: "desc" },
    select,
  });
  return job ? { job, method: "recipient-recency" } : null;
}

function classifyDsnBounce(report: DsnRecipientReport): BounceType {
  // Map the enhanced status class to a basic code so classifyBounce's numeric
  // fallback applies (5.x.x -> 500-range, 4.x.x -> 400-range); the free-text
  // Diagnostic-Code drives the phrase patterns.
  const statusClass = report.status?.charAt(0);
  return classifyBounce({
    code: statusClass === "5" ? 500 : statusClass === "4" ? 400 : undefined,
    message: report.diagnosticCode,
  });
}

/**
 * Feed a parsed DSN into the delivery pipeline.
 *
 * For each *failed* recipient: correlate the originating EmailJob, record a
 * BOUNCED event, flip the job SENT -> FAILED, and run the auto-suppression
 * policy — the same sequence the send worker performs for a synchronous
 * rejection. When no job can be correlated the bounce still counts against the
 * address: org-level suppression proceeds from the recipient alone (the org
 * comes from the inbox account that received the DSN).
 *
 * For each *delivered* or *relayed* recipient: record a DELIVERED event tagged
 * `source: "dsn"`. This is the only delivery confirmation a self-hosted install
 * gets without an ESP webhook, and it was previously parsed and discarded — so
 * the dashboard had no honest delivery number to show at all. `relayed` counts:
 * the message left for a gateway that doesn't itself report, which is as far as
 * the delivery chain is observable from here.
 *
 * `delayed` and `expanded` remain non-events: neither is an outcome yet.
 */
export async function applyDsnBounce(input: {
  organizationId: string;
  inboundMessageId: string;
  threadEmailJobId: string | null;
  dsn: ParsedDsn;
}): Promise<void> {
  for (const report of input.dsn.recipients) {
    if (report.action === "delivered" || report.action === "relayed") {
      const correlated = await correlateEmailJob({
        organizationId: input.organizationId,
        recipient: report.recipient,
        threadEmailJobId: input.threadEmailJobId,
        originalMessageId: input.dsn.originalMessageId,
      });

      // An uncorrelated delivery report has nothing to attach to — unlike a
      // bounce, it carries no consequence for the address on its own.
      if (correlated) {
        await prisma.emailEvent.create({
          data: {
            organizationId: input.organizationId,
            emailJobId: correlated.job.id,
            type: "DELIVERED",
            metadata: {
              source: "dsn",
              inboundMessageId: input.inboundMessageId,
              correlation: correlated.method,
              finalRecipient: report.recipient,
              action: report.action,
              ...(report.status ? { status: report.status } : {}),
            },
          },
        });

        await enqueueLatestWebhookDeliveries({
          organizationId: input.organizationId,
          emailJobId: correlated.job.id,
          type: "DELIVERED",
        });
      }
      continue;
    }

    if (report.action !== "failed") {
      continue;
    }

    const bounceType = classifyDsnBounce(report);
    const correlated = await correlateEmailJob({
      organizationId: input.organizationId,
      recipient: report.recipient,
      threadEmailJobId: input.threadEmailJobId,
      originalMessageId: input.dsn.originalMessageId,
    });

    if (correlated) {
      await prisma.emailEvent.create({
        data: {
          organizationId: input.organizationId,
          emailJobId: correlated.job.id,
          type: "BOUNCED",
          metadata: {
            source: "dsn",
            inboundMessageId: input.inboundMessageId,
            correlation: correlated.method,
            finalRecipient: report.recipient,
            bounceType,
            ...(report.status ? { status: report.status } : {}),
            ...(report.diagnosticCode ? { reason: report.diagnosticCode } : {}),
          },
        },
      });

      // Only a delivered-then-bounced job flips to FAILED; SUPPRESSED,
      // CANCELLED, and in-flight statuses must not be overwritten (the status
      // filter is the compare-and-set guard, same pattern as the worker's
      // CANCELLED re-check).
      await prisma.emailJob.updateMany({
        where: { id: correlated.job.id, status: "SENT" },
        data: { status: "FAILED" },
      });

      await enqueueLatestWebhookDeliveries({
        organizationId: input.organizationId,
        emailJobId: correlated.job.id,
        type: "BOUNCED",
      });
    }

    // Hard/block bounces suppress immediately; a soft bounce only once the
    // org's threshold is reached (the event recorded above counts toward it —
    // an uncorrelated soft bounce has no event and so only counts prior ones).
    if (
      await shouldSuppressBounce({
        organizationId: input.organizationId,
        email: report.recipient,
        bounceType,
      })
    ) {
      await prisma.contact.updateMany({
        where: {
          organizationId: input.organizationId,
          email: { equals: report.recipient, mode: "insensitive" },
        },
        data: { status: "BOUNCED" },
      });
      await addSuppression({
        organizationId: input.organizationId,
        email: report.recipient,
        reason: "BOUNCE",
        source: `dsn:${input.inboundMessageId}`,
      });
    }
  }
}
