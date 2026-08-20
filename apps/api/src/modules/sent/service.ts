import type { Prisma } from "@prisma/client";
import type {
  SentEmail,
  SentEmailAttachment,
  SentEmailDetail,
  SentEmailEvent,
  SentEmailPage,
  SentEmailQueryInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  emailJobScope,
  resolveMailboxAccess,
  type MailboxAccess
} from "../../lib/mailbox-access.js";
import { prisma } from "../../lib/prisma.js";

/*
  The archive holds terminal outcomes only.

  SENT and FAILED are the two states a job reaches after the pipeline has had
  its say, so they are the two the sent view shows — a failed attempt is still
  something you tried to send, and hiding it would make "I sent that yesterday,
  where is it?" unanswerable. CANCELLED never left (it is pulled back from the
  outbox) and SUPPRESSED was never attempted (it belongs to Suppressions), so
  neither appears here.
*/
const ARCHIVED_STATUSES = ["SENT", "FAILED"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Event type that has to exist on the job for each engagement outcome. */
const OUTCOME_EVENT = {
  delivered: "DELIVERED",
  opened: "OPENED",
  clicked: "CLICKED",
  bounced: "BOUNCED",
  complained: "COMPLAINED"
} as const;

function buildWhere(
  query: SentEmailQueryInput,
  access: MailboxAccess
): Prisma.EmailJobWhereInput {
  const where: Prisma.EmailJobWhereInput = {
    organizationId: query.organizationId,
    status:
      query.outcome === "failed"
        ? "FAILED"
        : { in: [...ARCHIVED_STATUSES] },
    /*
      Mailbox scope goes in `AND`, not spread into this object: it is itself an
      OR, and the free-text search below sets `OR` too. A single object would
      let one overwrite the other, and a search term would quietly widen what a
      member can see.

      Omitted entirely for OWNER/ADMIN rather than added as an empty clause, so
      the unrestricted query stays exactly the query it was.
    */
    ...(access.unrestricted ? {} : { AND: [emailJobScope(access)] })
  };

  if (query.origin !== "all") {
    where.origin = query.origin;
  }

  if (query.smtpConnectionId) {
    where.smtpConnectionId = query.smtpConnectionId;
  }

  if (query.days > 0) {
    /*
      Windowed on createdAt rather than sentAt: a job that failed never got a
      sentAt, and "last 7 days" has to include the failures or the window
      quietly changes what it means depending on the outcome filter. The
      [organizationId, createdAt] index covers it.
    */
    where.createdAt = { gte: new Date(Date.now() - query.days * DAY_MS) };
  }

  const eventType =
    query.outcome !== "all" && query.outcome !== "failed"
      ? OUTCOME_EVENT[query.outcome]
      : null;
  if (eventType) {
    where.events = { some: { type: eventType } };
  }

  if (query.q) {
    where.OR = [
      { subject: { contains: query.q, mode: "insensitive" } },
      // toEmail is the comma-joined To set for multi-recipient manual sends, so
      // a substring match finds an address wherever it sits in the list.
      { toEmail: { contains: query.q, mode: "insensitive" } },
      { campaign: { name: { contains: query.q, mode: "insensitive" } } }
    ];
  }

  return where;
}

type ArchivedJob = {
  id: string;
  subject: string;
  toEmail: string;
  cc: string[];
  bcc: string[];
  status: string;
  origin: string;
  sentAt: Date | null;
  createdAt: Date;
  campaignId: string | null;
  campaign: { name: string } | null;
  smtpConnection: {
    name: string;
    fromEmail: string;
    fromName: string | null;
  } | null;
  events: { type: string; metadata?: unknown }[];
};

/**
 * Whether one recorded event was judged to be a machine rather than a person.
 *
 * Written by the tracking service at record time (a security scanner's
 * User-Agent, or a fetch arriving seconds after the send). Read defensively:
 * every row written before classification existed has no such marker, and must
 * read as a human open rather than throwing while rendering someone's archive.
 */
function isAutomated(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as Record<string, unknown>).automated === true;
}

function toSentEmail(job: ArchivedJob): SentEmail {
  let opens = 0;
  let clicks = 0;
  let delivered = false;
  let bounced = false;
  let complained = false;

  for (const event of job.events) {
    /*
      Automated fetches are excluded from the counts the archive shows.

      A link scanner pulling the pixel is not engagement, and a row reading
      "1 open" when the only fetch came from a security appliance is worse than
      no number at all — it is a number someone will act on. The events
      themselves are untouched; only this summary discounts them.
    */
    if (event.type === "OPENED") {
      if (!isAutomated(event.metadata)) opens += 1;
    } else if (event.type === "CLICKED") clicks += 1;
    else if (event.type === "DELIVERED") delivered = true;
    else if (event.type === "BOUNCED") bounced = true;
    else if (event.type === "COMPLAINED") complained = true;
  }

  return {
    id: job.id,
    subject: job.subject,
    to: job.toEmail
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean),
    ccCount: job.cc.length,
    bccCount: job.bcc.length,
    status: job.status as SentEmail["status"],
    origin: job.origin as SentEmail["origin"],
    sentAt: job.sentAt ? job.sentAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    campaignId: job.campaignId,
    campaignName: job.campaign?.name ?? null,
    sendingAccount: job.smtpConnection
      ? {
          name: job.smtpConnection.name,
          fromEmail: job.smtpConnection.fromEmail,
          fromName: job.smtpConnection.fromName
        }
      : null,
    delivered,
    bounced,
    complained,
    opens,
    clicks
  };
}


/*
  The readable half of an event's metadata.

  Each event type writes its own shape (a bounce records `reason`, a failure
  `message`, a click the `url` it rewrote), so the reader would otherwise have
  to know all three to show one line. Read defensively: metadata is a Json
  column written by several code paths over several releases, and a shape that
  has since changed must degrade to "no detail", never throw while rendering
  someone's archive.
*/
const EVENT_DETAIL_KEYS = ["reason", "message", "url", "error"] as const;

function eventDetail(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  for (const key of EVENT_DETAIL_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

interface ArchivedEvent {
  id: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
}

/**
 * Fold a message's raw event log into the history a person reads.
 *
 * The pipeline records one row per thing that happened, and for opens "a thing
 * that happened" is a fetch of the tracking pixel — which a mail client repeats
 * on every render, and which our own no-store headers deliberately stop any
 * proxy from caching. One person reading one email once routinely writes ten of
 * them, and rendered literally that history is ten identical lines saying
 * "Opened" and nothing about the message.
 *
 * So identical events collapse into one entry: keyed on type *and* detail, so
 * two clicks on different links stay two lines and two bounces for different
 * reasons stay two reasons, while ten fetches of one pixel become one line that
 * says it happened ten times. The entry sits at the first occurrence and
 * carries the last, because "opened, and still being opened six hours later" is
 * the interesting shape and a single timestamp can't show it.
 *
 * Nothing is dropped — the folded counts add up to the rows in the table, and
 * the API still has every one of them.
 */
function foldEvents(events: ArchivedEvent[]): SentEmailEvent[] {
  const order: string[] = [];
  const folded = new Map<string, SentEmailEvent>();

  for (const event of events) {
    const detail = eventDetail(event.metadata);
    // Keyed through JSON rather than by joining with a separator: a detail is
    // a URL or an SMTP response and can contain any printable character, so
    // there is no separator that two different pairs cannot collide on.
    const key = JSON.stringify([event.type, detail]);
    const occurredAt = event.occurredAt.toISOString();
    const automated = isAutomated(event.metadata) ? 1 : 0;
    const existing = folded.get(key);

    if (!existing) {
      order.push(key);
      folded.set(key, {
        id: event.id,
        type: event.type as SentEmailEvent["type"],
        occurredAt,
        detail,
        count: 1,
        lastOccurredAt: null,
        automatedCount: automated
      });
      continue;
    }

    // Events arrive oldest-first, so the last one seen is the newest.
    existing.count += 1;
    existing.lastOccurredAt = occurredAt;
    existing.automatedCount += automated;
  }

  return order.map((key) => folded.get(key)!);
}

/**
 * Why this send failed, in one line.
 *
 * FAILED is the pipeline giving up; BOUNCED with a FAILED job status is the
 * SMTP server refusing the recipient outright. Both are "it did not arrive and
 * here is what we were told", and the reader shows one sentence, so the newest
 * of either wins. Null for anything that did not fail — a delivered message
 * with an old soft bounce on record has not failed.
 */
function failureReasonOf(
  status: string,
  events: ArchivedEvent[]
): string | null {
  if (status !== "FAILED") return null;
  // Read from the raw log rather than the folded history: folding orders
  // entries by first occurrence, and "the newest explanation" has to mean the
  // newest event, not the newest distinct one.
  const explained = events
    .filter((event) => event.type === "FAILED" || event.type === "BOUNCED")
    .reverse();
  for (const event of explained) {
    const detail = eventDetail(event.metadata);
    if (detail) return detail;
  }
  return null;
}

export const sentService = {

  /**
   * One archived message in full, body included.
   *
   * Deliberately a second request rather than more columns on the list: the
   * body is the widest column in the schema, and a page of 25 subjects has no
   * use for 25 rendered emails. Scoped exactly like the list — same mailbox
   * rule, applied to one row instead of a where clause — and 404 rather than
   * 403 for a message outside that scope, because it is not in this reader's
   * archive at all, which is what the list already tells them.
   */
  async get(
    id: string,
    organizationId: string,
    userId: string
  ): Promise<SentEmailDetail> {
    const access = await resolveMailboxAccess(userId, organizationId);

    const job = await prisma.emailJob.findFirst({
      where: {
        id,
        organizationId,
        status: { in: [...ARCHIVED_STATUSES] },
        ...(access.unrestricted ? {} : { AND: [emailJobScope(access)] })
      },
      select: {
        id: true,
        subject: true,
        toEmail: true,
        cc: true,
        bcc: true,
        replyTo: true,
        status: true,
        origin: true,
        sentAt: true,
        createdAt: true,
        messageId: true,
        campaignId: true,
        campaign: { select: { name: true } },
        smtpConnection: {
          select: { name: true, fromEmail: true, fromName: true }
        },
        html: true,
        text: true,
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
            cid: true
          },
          orderBy: { createdAt: "asc" }
        },
        // Oldest first: this is read top-to-bottom as the message's history.
        events: {
          select: {
            id: true,
            type: true,
            occurredAt: true,
            metadata: true
          },
          orderBy: { occurredAt: "asc" }
        }
      }
    });

    if (!job) {
      throw new HttpError(404, "Email not found", "not_found");
    }

    // toSentEmail folds the events into counts and flags, and only reads
    // `type` — so the same rows serve both the summary and the timeline below.
    const summary = toSentEmail(job as unknown as ArchivedJob);
    const recorded = job.events as unknown as ArchivedEvent[];
    const events = foldEvents(recorded);

    const attachments: SentEmailAttachment[] = job.attachments.map(
      (attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        // A Content-ID is what makes a part inline: the body references it with
        // `cid:` and renders it in place instead of offering a download.
        isInline: Boolean(attachment.cid),
        contentId: attachment.cid
      })
    );

    return {
      ...summary,
      html: job.html,
      text: job.text,
      cc: job.cc,
      bcc: job.bcc,
      replyTo: job.replyTo,
      messageId: job.messageId,
      attachments,
      events,
      failureReason: failureReasonOf(job.status, recorded)
    };
  },

  /**
   * A page of the sent archive, newest first, filtered on the server.
   *
   * Every other list in this app hands the browser the whole table and lets the
   * grid filter it. This one cannot: it is the only view whose row count grows
   * with everything the organization has ever sent, so search, filters, sort
   * and paging all happen in Postgres and the client only ever holds one page.
   *
   * Scoped to the reader's mailboxes: for an OWNER/ADMIN the archive is still
   * the whole organization's mail log, but a MEMBER sees only what went out
   * from a mailbox they hold, plus their own sends.
   */
  async list(query: SentEmailQueryInput, userId: string): Promise<SentEmailPage> {
    const access = await resolveMailboxAccess(userId, query.organizationId);
    const where = buildWhere(query, access);

    const [jobs, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        /*
          Sent time is what someone is looking for, but a failed job has none —
          and Postgres sorts NULLs first on DESC, which would float every
          failure to the top of the archive. `nulls: "last"` keeps them in the
          createdAt tie-break instead.
        */
        orderBy: [
          { sentAt: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" }
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          subject: true,
          toEmail: true,
          cc: true,
          bcc: true,
          status: true,
          origin: true,
          sentAt: true,
          createdAt: true,
          campaignId: true,
          campaign: { select: { name: true } },
          smtpConnection: {
            select: { name: true, fromEmail: true, fromName: true }
          },
          // Folded into counts and flags below. The metadata comes along
          // because an automated open (a scanner, a privacy proxy) must not be
          // counted as engagement — it is a small JSON blob per event, and the
          // alternative is a second query per row.
          events: { select: { type: true, metadata: true } }
        }
      }),
      prisma.emailJob.count({ where })
    ]);

    return {
      rows: (jobs as unknown as ArchivedJob[]).map(toSentEmail),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  }
};
