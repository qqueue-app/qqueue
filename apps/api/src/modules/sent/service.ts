import type { Prisma } from "@prisma/client";
import type {
  SentEmail,
  SentEmailPage,
  SentEmailQueryInput
} from "@qqueue/shared";
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

function buildWhere(query: SentEmailQueryInput): Prisma.EmailJobWhereInput {
  const where: Prisma.EmailJobWhereInput = {
    organizationId: query.organizationId,
    status:
      query.outcome === "failed"
        ? "FAILED"
        : { in: [...ARCHIVED_STATUSES] }
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

export const sentService = {
  /**
   * A page of the sent archive, newest first, filtered on the server.
   *
   * Every other list in this app hands the browser the whole table and lets the
   * grid filter it. This one cannot: it is the only view whose row count grows
   * with everything the organization has ever sent, so search, filters, sort
   * and paging all happen in Postgres and the client only ever holds one page.
   */
  async list(query: SentEmailQueryInput): Promise<SentEmailPage> {
    const where = buildWhere(query);

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
