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
  events: { type: string }[];
};

function toSentEmail(job: ArchivedJob): SentEmail {
  let opens = 0;
  let clicks = 0;
  let delivered = false;
  let bounced = false;
  let complained = false;

  for (const event of job.events) {
    if (event.type === "OPENED") opens += 1;
    else if (event.type === "CLICKED") clicks += 1;
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

function toSentEmailEvent(event: ArchivedEvent): SentEmailEvent {
  return {
    id: event.id,
    type: event.type as SentEmailEvent["type"],
    occurredAt: event.occurredAt.toISOString(),
    detail: eventDetail(event.metadata)
  };
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
  events: SentEmailEvent[]
): string | null {
  if (status !== "FAILED") return null;
  const explained = events
    .filter((event) => event.type === "FAILED" || event.type === "BOUNCED")
    .reverse();
  return explained.find((event) => event.detail)?.detail ?? null;
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
    const events = (job.events as unknown as ArchivedEvent[]).map(
      toSentEmailEvent
    );

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
      failureReason: failureReasonOf(job.status, events)
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
          // Folded into counts and flags below. Only the type is read, so this
          // stays a narrow join even for a job with a long open history.
          events: { select: { type: true } }
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
