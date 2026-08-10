import { randomUUID } from "node:crypto";
import {
  type EmailBranding,
  injectTracking,
  renderHtmlAsEmailSafe
} from "@qqueue/email-engine";
import type {
  EmailPreviewInput,
  EmailPreviewResult,
  ManualEmailDeliveryStatus,
  ManualEmailSendInput,
  RecipientDelivery,
  RecipientDeliveryStatus,
  RecipientSuggestion,
  TransactionalSendResponse
} from "@qqueue/shared";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { suppressionService } from "../suppressions/service.js";
import { transactionalEmailService } from "../transactional-email/service.js";

interface RecipientSource {
  organizationId: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  contactIds?: string[];
  listIds?: string[];
}

export interface ResolvedRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
  total: number;
}

// Emails are case-insensitive in practice, so normalize for dedup while keeping
// a stable, predictable casing in the output.
function normalize(email: string) {
  return email.trim().toLowerCase();
}

function dedupe(emails: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const email = normalize(raw);
    if (email && !seen.has(email)) {
      seen.add(email);
      result.push(email);
    }
  }
  return result;
}

/**
 * Expand manual addresses, individual contacts, and whole contact lists into a
 * deduplicated set of To/CC/BCC recipients, all scoped to the organization. A
 * recipient is only ever counted once: CC drops anything already in To, and BCC
 * drops anything already in To or CC.
 */
export async function resolveRecipients(
  input: RecipientSource
): Promise<ResolvedRecipients> {
  const contactIds = new Set(input.contactIds ?? []);

  if (input.listIds?.length) {
    const members = await prisma.contactListMember.findMany({
      where: {
        contactListId: { in: input.listIds },
        contactList: { organizationId: input.organizationId }
      },
      select: { contactId: true }
    });
    for (const member of members) {
      contactIds.add(member.contactId);
    }
  }

  let contactEmails: string[] = [];
  if (contactIds.size > 0) {
    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: [...contactIds] },
        organizationId: input.organizationId
      },
      select: { email: true }
    });
    contactEmails = contacts.map((contact) => contact.email);
  }

  const to = dedupe([...(input.to ?? []), ...contactEmails]);
  const toSet = new Set(to);

  const cc = dedupe(input.cc ?? []).filter((email) => !toSet.has(email));
  const ccSet = new Set(cc);

  const bcc = dedupe(input.bcc ?? []).filter(
    (email) => !toSet.has(email) && !ccSet.has(email)
  );

  return { to, cc, bcc, total: to.length + cc.length + bcc.length };
}

/**
 * The organization's branding, shaped for the render layer. Nulls become
 * `undefined` because that is how `EmailBranding` spells "add nothing": a header
 * is drawn only when a brand name or logo exists, so an unbranded org keeps
 * shipping exactly its own content.
 *
 * `footerNote` is included here because a manual send is not bulk and so never
 * receives the send-time unsubscribe footer. Bulk paths must NOT pass it — the
 * footer beside the unsubscribe link already carries it, and passing it in both
 * places prints the address twice.
 */
async function orgBranding(organizationId: string): Promise<EmailBranding> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      brandName: true,
      logoUrl: true,
      accentColor: true,
      footerNote: true
    }
  });

  return {
    brandName: organization?.brandName ?? undefined,
    logoUrl: organization?.logoUrl ?? undefined,
    accentColor: organization?.accentColor ?? undefined,
    footerNote: organization?.footerNote ?? undefined
  };
}

/**
 * Render the composer body through the canonical MJML email-safe layer, wearing
 * the organization's branding. This is the exact transformation applied to
 * manual sends, so the preview can reuse it to match the delivered email.
 */
async function renderBody(html: string | undefined, organizationId: string) {
  if (!html) {
    return undefined;
  }
  const result = await renderHtmlAsEmailSafe(html, {
    branding: await orgBranding(organizationId)
  });

  // renderHtmlAsEmailSafe never throws: a compile failure silently degrades to
  // the raw body HTML. Surface that, or the send just quietly stops being
  // email-safe with nothing to explain why.
  if (result.usedFallback) {
    console.error(
      `[manual-email] MJML compilation failed; sending unwrapped body HTML. ${result.errors.join("; ")}`
    );
  } else if (result.errors.length > 0) {
    console.warn(
      `[manual-email] MJML validation reported issues: ${result.errors.join("; ")}`
    );
  }

  return result.html;
}

// How far back the recipient suggestions look, and how many addresses they
// return. Both are caps rather than tuning knobs: the composer holds the whole
// list in memory and filters it client-side.
const SUGGESTION_JOB_SCAN = 500;
const SUGGESTION_LIMIT = 200;

// Autocomplete is advisory, so a per-org read-through cache is enough to keep
// every composer load off a 500-row scan. Entries are only refreshed on read,
// which means an address mailed for the first time shows up within the TTL —
// acceptable for a convenience list, and contacts are merged in live by the
// client regardless. Per-process by design: nothing here is worth a Redis
// round-trip, and a second API instance simply keeps its own copy.
const SUGGESTION_CACHE_TTL_MS = 60_000;
const SUGGESTION_CACHE_MAX_ORGS = 100;

const suggestionCache = new Map<
  string,
  { value: RecipientSuggestion[]; expiresAt: number }
>();

export const manualEmailService = {
  resolveRecipients,

  /**
   * Addresses this organization has mailed before, newest first. The composer
   * merges these with the contact book so someone who was emailed once (but
   * never saved as a contact) can still be autocompleted.
   */
  async recentRecipients(organizationId: string): Promise<RecipientSuggestion[]> {
    const cached = suggestionCache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const jobs = await prisma.emailJob.findMany({
      where: { organizationId },
      select: { toEmail: true, cc: true, bcc: true },
      orderBy: { createdAt: "desc" },
      take: SUGGESTION_JOB_SCAN
    });

    // toEmail is the comma-joined To set (see deliveryStatus), so it has to be
    // split back out before deduplicating.
    const addresses = jobs.flatMap((job) => [
      ...job.toEmail.split(","),
      ...job.cc,
      ...job.bcc
    ]);

    const suggestions = dedupe(addresses)
      .slice(0, SUGGESTION_LIMIT)
      .map((email) => ({ email, source: "recent" as const }));

    // Drop expired entries before growing, then evict the oldest insertion if
    // the map is still at its ceiling — an unbounded map would pin every org
    // this process has ever served in memory.
    if (suggestionCache.size >= SUGGESTION_CACHE_MAX_ORGS) {
      const now = Date.now();
      for (const [key, entry] of suggestionCache) {
        if (entry.expiresAt <= now) {
          suggestionCache.delete(key);
        }
      }
      if (suggestionCache.size >= SUGGESTION_CACHE_MAX_ORGS) {
        const oldest = suggestionCache.keys().next();
        if (!oldest.done) {
          suggestionCache.delete(oldest.value);
        }
      }
    }

    suggestionCache.set(organizationId, {
      value: suggestions,
      expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS
    });

    return suggestions;
  },

  /** Test seam: drop every cached suggestion list. */
  clearRecipientSuggestionCache() {
    suggestionCache.clear();
  },

  /**
   * Send a manually composed email. Recipients are resolved + deduplicated, the
   * body is rendered through MJML, and the message becomes **one EmailJob per
   * To recipient** in the shared send pipeline (`origin: "MANUAL"`), so
   * suppression checks, per-domain throttling, and bounce accounting apply to
   * each recipient individually — a comma-joined To defeated all three.
   *
   * CC/BCC ride exactly one job (the "carrier": the first To recipient not
   * already suppressed), so copy-recipients get one copy of the message, not
   * one per To. If every To recipient is suppressed, nothing is sent — copies
   * included. See docs/DECISIONS.md ("Manual sends fan out per recipient").
   *
   * Returns the carrier job: it's the one whose delivery status the composer
   * polls, and `deliveryStatus` aggregates its siblings via `sendGroupId`.
   */
  async send(
    input: ManualEmailSendInput,
    userId: string
  ): Promise<TransactionalSendResponse> {
    const recipients = await resolveRecipients(input);

    if (recipients.to.length === 0) {
      throw new HttpError(
        400,
        "At least one recipient is required",
        "validation_error"
      );
    }

    const html = await renderBody(input.html, input.organizationId);

    // The carrier must be a recipient that will actually send, or the CC/BCC
    // copies would silently die with a suppressed To. (Recipients suppressed
    // *after* this check are handled by the worker; that race is accepted.)
    const suppressed = await suppressionService.suppressedAmong(
      input.organizationId,
      recipients.to
    );
    const firstDeliverable = recipients.to.findIndex(
      (email) => !suppressed.has(email)
    );
    const carrierIndex = Math.max(0, firstDeliverable);

    const sendGroupId = recipients.to.length > 1 ? randomUUID() : null;

    const base = {
      organizationId: input.organizationId,
      replyTo: input.replyTo,
      smtpConnectionId: input.smtpConnectionId,
      templateId: input.templateId,
      subject: input.subject,
      html,
      text: input.text,
      variables: input.variables,
      inReplyTo: input.inReplyTo,
      references: input.references,
      scheduledAt: input.scheduledAt,
      origin: "MANUAL" as const,
      createdByUserId: userId,
      sendGroupId
    };

    const results: TransactionalSendResponse[] = [];
    for (const [index, recipient] of recipients.to.entries()) {
      const isCarrier = index === carrierIndex;
      results.push(
        await transactionalEmailService.send({
          ...base,
          to: recipient,
          cc: isCarrier && recipients.cc.length ? recipients.cc : undefined,
          bcc: isCarrier && recipients.bcc.length ? recipients.bcc : undefined,
          attachmentIds: input.attachmentIds,
          // The first job claims the uploaded attachment rows; siblings get
          // metadata copies pointing at the same stored blobs.
          attachmentMode: index === 0 ? "link" : "copy"
        })
      );
    }

    return results[carrierIndex];
  },

  /**
   * Build a preview that matches what will actually be delivered: the body runs
   * through the same MJML render + tracking injection used when sending, and the
   * recipient summary is the resolved, deduplicated set.
   */
  async preview(input: EmailPreviewInput): Promise<EmailPreviewResult> {
    const recipients = await resolveRecipients(input);
    const rendered = await renderBody(input.html, input.organizationId);
    const html =
      injectTracking(rendered, {
        emailJobId: "preview",
        baseUrl: env.APP_URL,
        secret: env.TRACKING_SECRET
      }) ??
      rendered ??
      "";

    return {
      subject: input.subject ?? "",
      html,
      recipients
    };
  },

  /**
   * Derive per-recipient delivery status for a manual send. A multi-recipient
   * send is one EmailJob per To recipient (linked by `sendGroupId`), so each To
   * row reports its own job's status; CC/BCC rows come from the carrier job.
   * Engagement counts aggregate across the whole group. Pre-fan-out jobs (a
   * comma-joined To on one job) still resolve per recipient via the SMTP
   * accepted/rejected lists recorded on their events.
   */
  async deliveryStatus(
    emailJobId: string,
    organizationId: string
  ): Promise<ManualEmailDeliveryStatus> {
    const jobSelect = {
      id: true,
      status: true,
      sentAt: true,
      toEmail: true,
      cc: true,
      bcc: true,
      sendGroupId: true,
      createdAt: true,
      events: { select: { type: true, metadata: true } }
    } as const;

    const job = await prisma.emailJob.findFirst({
      where: { id: emailJobId, organizationId },
      select: jobSelect
    });

    if (!job) {
      throw new HttpError(404, "Email not found", "not_found");
    }

    const jobs = job.sendGroupId
      ? await prisma.emailJob.findMany({
          where: { organizationId, sendGroupId: job.sendGroupId },
          select: jobSelect,
          orderBy: { createdAt: "asc" }
        })
      : [job];

    let opens = 0;
    let clicks = 0;
    let bounces = 0;
    let complaints = 0;
    const recipients: RecipientDelivery[] = [];

    for (const groupJob of jobs) {
      const accepted = new Set<string>();
      const rejected = new Set<string>();

      for (const event of groupJob.events) {
        const metadata = (event.metadata ?? {}) as {
          accepted?: unknown;
          rejected?: unknown;
        };
        if (Array.isArray(metadata.accepted)) {
          for (const address of metadata.accepted) {
            accepted.add(String(address).toLowerCase());
          }
        }
        if (Array.isArray(metadata.rejected)) {
          for (const address of metadata.rejected) {
            rejected.add(String(address).toLowerCase());
          }
        }
        if (event.type === "OPENED") opens += 1;
        else if (event.type === "CLICKED") clicks += 1;
        else if (event.type === "BOUNCED") bounces += 1;
        else if (event.type === "COMPLAINED") complaints += 1;
      }

      // Accepted/rejected from the SMTP result decide first; the job status
      // fills in only for outcomes that never reach SMTP (suppressed,
      // cancelled) or produced no per-address result (failed).
      const statusFor = (email: string): RecipientDeliveryStatus => {
        const key = email.toLowerCase();
        if (rejected.has(key)) return "rejected";
        if (accepted.has(key)) return "delivered";
        if (groupJob.status === "SUPPRESSED") return "suppressed";
        if (
          groupJob.status === "FAILED" ||
          groupJob.status === "CANCELLED"
        ) {
          return "failed";
        }
        return "pending";
      };

      // toEmail is one address per job after fan-out; older jobs may still
      // carry the legacy comma-joined To set.
      const toList = groupJob.toEmail
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean);

      recipients.push(
        ...toList.map((email) => ({
          email,
          field: "to" as const,
          status: statusFor(email)
        })),
        ...groupJob.cc.map((email) => ({
          email,
          field: "cc" as const,
          status: statusFor(email)
        })),
        ...groupJob.bcc.map((email) => ({
          email,
          field: "bcc" as const,
          status: statusFor(email)
        }))
      );
    }

    // One aggregate status for the group, chosen so the composer's poll
    // terminates correctly: stay non-terminal while any job is still moving,
    // then prefer reporting a send over a failure over a suppression.
    const TERMINAL = new Set(["SENT", "FAILED", "SUPPRESSED", "CANCELLED"]);
    const allTerminal = jobs.every((groupJob) =>
      TERMINAL.has(groupJob.status)
    );
    const aggregateStatus = !allTerminal
      ? jobs.some((groupJob) => groupJob.status === "PROCESSING")
        ? "PROCESSING"
        : "QUEUED"
      : jobs.some((groupJob) => groupJob.status === "SENT")
        ? "SENT"
        : jobs.some((groupJob) => groupJob.status === "FAILED")
          ? "FAILED"
          : jobs.some((groupJob) => groupJob.status === "CANCELLED")
            ? "CANCELLED"
            : "SUPPRESSED";

    const sentAtTimes = jobs
      .map((groupJob) => groupJob.sentAt)
      .filter((value): value is Date => Boolean(value))
      .map((value) => value.getTime());

    return {
      id: job.id,
      status: aggregateStatus,
      sentAt: sentAtTimes.length
        ? new Date(Math.max(...sentAtTimes)).toISOString()
        : null,
      recipients,
      opens,
      clicks,
      bounces,
      complaints
    };
  }
};
