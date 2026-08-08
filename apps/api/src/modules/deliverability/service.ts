import { Prisma } from "@prisma/client";
import {
  type DeliverabilityDomains,
  type DeliverabilityOverview,
  type DeliverySignal,
  deriveReputationAlerts
} from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";

/**
 * A DELIVERED event only counts as delivery confirmation when it came from a
 * source that observes delivery. `recordOpen` used to synthesize DELIVERED from
 * the tracking pixel, which made "delivery rate" a relabelled open rate; those
 * legacy rows carry no `metadata.source` and are excluded here by construction.
 */
const CONFIRMED_DELIVERY_SOURCES = ["webhook", "dsn"] as const;

const confirmedDeliveryFilter = {
  type: "DELIVERED" as const,
  OR: CONFIRMED_DELIVERY_SOURCES.map((source) => ({
    metadata: { path: ["source"], equals: source }
  }))
};

function resolveWindow(input: { from?: string; to?: string }) {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * The job cohort for a window: everything whose send attempt happened in it.
 *
 * Anchored on the job's own timeline (`sentAt`, falling back to `createdAt` for
 * jobs that never reached a send) rather than on event timestamps. A DSN that
 * arrives on Tuesday for Monday's send belongs to Monday's cohort — anchoring
 * on the event would score it against Tuesday's sends, which is how a numerator
 * and denominator end up describing different populations.
 */
function jobCohort(organizationId: string, from: Date, to: Date) {
  return {
    organizationId,
    OR: [
      { sentAt: { gte: from, lte: to } },
      { sentAt: null, createdAt: { gte: from, lte: to } }
    ]
  };
}

/**
 * The subset of a cohort that reached a terminal send outcome.
 *
 * Reputation numerators are counted over this, not over the whole cohort, so a
 * numerator can never describe a population its denominator excludes — the
 * failure mode this module's header comment is about. Without it a bounce
 * recorded against a job that ended up SUPPRESSED or CANCELLED would count in
 * `bounced` while sitting outside `attempted`, and the rate could exceed 100%.
 */
function terminalCohort(
  organizationId: string,
  from: Date,
  to: Date
): Prisma.EmailJobWhereInput {
  return {
    ...jobCohort(organizationId, from, to),
    status: { in: ["SENT", "FAILED"] }
  };
}

/** `null` rather than 0 when there is no denominator — see the shared type. */
const rate = (value: number, total: number): number | null =>
  total > 0 ? value / total : null;

/** Distinct *jobs* matching an event filter, never a raw event count. */
async function distinctJobs(
  cohort: Prisma.EmailJobWhereInput,
  where: Prisma.EmailEventWhereInput
): Promise<number> {
  const rows = await prisma.emailEvent.groupBy({
    by: ["emailJobId"],
    where: { ...where, emailJob: cohort }
  });
  return rows.length;
}

const bounceClass = (bounceType: "HARD" | "SOFT" | "BLOCK") => ({
  type: "BOUNCED" as const,
  metadata: { path: ["bounceType"], equals: bounceType }
});

export const deliverabilityService = {
  async overview(input: {
    organizationId: string;
    from?: string;
    to?: string;
  }): Promise<DeliverabilityOverview> {
    const { from, to } = resolveWindow(input);
    const cohort = jobCohort(input.organizationId, from, to);
    const terminal = terminalCohort(input.organizationId, from, to);

    const [
      byStatus,
      failedBeforeHandoff,
      confirmedDelivered,
      deliverySource,
      bounced,
      hardBounced,
      softBounced,
      blockBounced,
      complained,
      opened,
      clicked,
      suppressedInWindow,
      suppressedTotal
    ] = await Promise.all([
      prisma.emailJob.groupBy({
        by: ["status"],
        where: cohort,
        _count: { _all: true }
      }),
      // A FAILED job with no BOUNCED event never reached a recipient's mail
      // server: the send threw before handoff. `events: { none: ... }` rather
      // than a FAILED-event lookup because a job can carry both (it bounced on
      // one attempt and errored on another), and a bounce is the stronger fact.
      prisma.emailJob.count({
        where: { ...cohort, status: "FAILED", events: { none: { type: "BOUNCED" } } }
      }),
      distinctJobs(terminal, confirmedDeliveryFilter),
      // Org-wide and all-time: distinguishes "no deliveries confirmed in this
      // window" from "nothing here can confirm a delivery at all".
      prisma.emailEvent.findFirst({
        where: { organizationId: input.organizationId, ...confirmedDeliveryFilter },
        select: { id: true }
      }),
      distinctJobs(terminal, { type: "BOUNCED" }),
      distinctJobs(terminal, bounceClass("HARD")),
      distinctJobs(terminal, bounceClass("SOFT")),
      distinctJobs(terminal, bounceClass("BLOCK")),
      distinctJobs(terminal, { type: "COMPLAINED" }),
      distinctJobs(cohort, { type: "OPENED" }),
      distinctJobs(cohort, { type: "CLICKED" }),
      prisma.suppression.count({
        where: {
          organizationId: input.organizationId,
          createdAt: { gte: from, lte: to }
        }
      }),
      prisma.suppression.count({ where: { organizationId: input.organizationId } })
    ]);

    const jobs = Object.fromEntries(
      byStatus.map((row: { status: string; _count: { _all: number } }) => [
        row.status,
        row._count._all
      ])
    ) as Partial<Record<string, number>>;

    const sent = jobs.SENT ?? 0;
    const failed = jobs.FAILED ?? 0;
    // Suppressed and cancelled recipients were never attempted, so they belong
    // in neither the numerator nor the denominator of a delivery rate.
    const suppressedAtSend = jobs.SUPPRESSED ?? 0;
    const cancelled = jobs.CANCELLED ?? 0;
    const inFlight =
      (jobs.PENDING ?? 0) + (jobs.QUEUED ?? 0) + (jobs.PROCESSING ?? 0);
    // Everything that reached a terminal send outcome, of either kind.
    const terminalTotal = sent + failed;
    // ...minus the failures that never reached a recipient's mail server. See
    // the shared type: folding those in here deflates every reputation rate,
    // and an SMTP outage during a send is exactly when the rates matter most.
    const attempted = terminalTotal - failedBeforeHandoff;

    const deliverySignal: DeliverySignal = deliverySource ? "confirmed" : "none";

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      deliverySignal,
      totals: {
        attempted,
        sent,
        failed,
        failedBeforeHandoff,
        suppressedAtSend,
        cancelled,
        inFlight,
        confirmedDelivered,
        bounced,
        hardBounced,
        softBounced,
        blockBounced,
        complained,
        opened,
        clicked,
        suppressedInWindow,
        suppressedTotal
      },
      rates: {
        accepted: rate(sent, attempted),
        confirmedDelivery:
          deliverySignal === "none" ? null : rate(confirmedDelivered, sent),
        bounce: rate(bounced, attempted),
        complaint: rate(complained, attempted),
        open: rate(opened, sent),
        click: rate(clicked, sent),
        deliveryFailure: rate(failedBeforeHandoff, terminalTotal)
      }
    };
  },

  /**
   * Per-recipient-domain funnel, aggregated in Postgres.
   *
   * Grouped in SQL rather than by scanning events in Node. The old scan took
   * the newest 5,000 events of *every* type, so opens and clicks consumed the
   * cap, and because the slice was time-ordered a domain's later bounces could
   * survive while its earlier sends were cut — leaving `bounced / 0`, which the
   * rate helper rendered as a reassuring 0.0% on the worst domain in the table.
   */
  async domains(input: {
    organizationId: string;
    from?: string;
    to?: string;
  }): Promise<DeliverabilityDomains> {
    const { from, to } = resolveWindow(input);

    const rows = await prisma.$queryRaw<
      Array<{
        domain: string;
        attempted: bigint;
        sent: bigint;
        failedBeforeHandoff: bigint;
        bounced: bigint;
        complained: bigint;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(NULLIF(split_part(lower(j."toEmail"), '@', 2), ''), '(unknown)')
          AS domain,
        COUNT(*) FILTER (WHERE
          j.status = 'SENT'
          OR (j.status = 'FAILED' AND EXISTS (
            SELECT 1 FROM "EmailEvent" e
            WHERE e."emailJobId" = j.id AND e.type = 'BOUNCED'
          ))
        ) AS attempted,
        COUNT(*) FILTER (WHERE j.status = 'SENT') AS sent,
        COUNT(*) FILTER (WHERE
          j.status = 'FAILED' AND NOT EXISTS (
            SELECT 1 FROM "EmailEvent" e
            WHERE e."emailJobId" = j.id AND e.type = 'BOUNCED'
          )
        ) AS "failedBeforeHandoff",
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "EmailEvent" e
          WHERE e."emailJobId" = j.id AND e.type = 'BOUNCED'
        )) AS bounced,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "EmailEvent" e
          WHERE e."emailJobId" = j.id AND e.type = 'COMPLAINED'
        )) AS complained
      FROM "EmailJob" j
      WHERE j."organizationId" = ${input.organizationId}
        AND (
          (j."sentAt" >= ${from} AND j."sentAt" <= ${to})
          OR (j."sentAt" IS NULL AND j."createdAt" >= ${from} AND j."createdAt" <= ${to})
        )
      GROUP BY 1
      -- Deliberately the full terminal population, not the attempted column:
      -- a domain whose every send died before handoff has attempted = 0, and
      -- dropping it here would hide the outage instead of reporting it.
      HAVING COUNT(*) FILTER (WHERE j.status IN ('SENT', 'FAILED')) > 0
      ORDER BY attempted DESC, domain ASC
    `);

    return {
      domains: rows.map((row) => {
        const attempted = Number(row.attempted);
        const bounced = Number(row.bounced);
        const complained = Number(row.complained);
        return {
          domain: row.domain,
          attempted,
          sent: Number(row.sent),
          failedBeforeHandoff: Number(row.failedBeforeHandoff),
          bounced,
          complained,
          bounceRate: rate(bounced, attempted),
          complaintRate: rate(complained, attempted)
        };
      })
    };
  },

  /** Structured reputation alerts. Served for API consumers; the dashboard
   * derives the same list from the overview it already has. */
  async alerts(input: { organizationId: string; from?: string; to?: string }) {
    const overview = await this.overview(input);
    return { alerts: deriveReputationAlerts(overview) };
  }
};
