import { prisma } from "../../lib/prisma.js";

// Reputation alert thresholds. Bounce/complaint rates above these are the
// industry red lines that get a sender throttled or blocklisted.
const BOUNCE_RATE_ALERT = 0.05;
const COMPLAINT_RATE_ALERT = 0.001;
// Cap on events scanned for the per-domain breakdown; surfaced as `truncated`.
const DOMAIN_SCAN_CAP = 5000;

function recipientDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "(unknown)" : email.slice(at + 1).toLowerCase();
}

function resolveWindow(input: { from?: string; to?: string }) {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

const rate = (value: number, total: number) => (total > 0 ? value / total : 0);

export const deliverabilityService = {
  async overview(input: { organizationId: string; from?: string; to?: string }) {
    const { from, to } = resolveWindow(input);
    const where = {
      organizationId: input.organizationId,
      occurredAt: { gte: from, lte: to }
    };

    const [byType, hardBounced, softBounced, uniqueOpens, uniqueClicks, suppressed] =
      await Promise.all([
        prisma.emailEvent.groupBy({
          by: ["type"],
          where,
          _count: { _all: true }
        }),
        prisma.emailEvent.count({
          where: { ...where, type: "BOUNCED", metadata: { path: ["bounceType"], equals: "HARD" } }
        }),
        prisma.emailEvent.count({
          where: { ...where, type: "BOUNCED", metadata: { path: ["bounceType"], equals: "SOFT" } }
        }),
        prisma.emailEvent.groupBy({
          by: ["emailJobId"],
          where: { ...where, type: "OPENED" }
        }),
        prisma.emailEvent.groupBy({
          by: ["emailJobId"],
          where: { ...where, type: "CLICKED" }
        }),
        prisma.suppression.count({ where: { organizationId: input.organizationId } })
      ]);

    const counts = Object.fromEntries(
      byType.map((row: { type: string; _count: { _all: number } }) => [
        row.type,
        row._count._all
      ])
    ) as Partial<Record<string, number>>;

    const sent = counts.SENT ?? 0;
    const delivered = counts.DELIVERED ?? 0;
    const bounced = counts.BOUNCED ?? 0;
    const complained = counts.COMPLAINED ?? 0;

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        sent,
        delivered,
        opened: uniqueOpens.length,
        clicked: uniqueClicks.length,
        bounced,
        hardBounced,
        softBounced,
        complained,
        suppressed
      },
      rates: {
        delivery: rate(delivered, sent),
        bounce: rate(bounced, sent),
        complaint: rate(complained, sent),
        open: rate(uniqueOpens.length, sent),
        click: rate(uniqueClicks.length, sent)
      }
    };
  },

  /** Per-recipient-domain event breakdown. Bounded by DOMAIN_SCAN_CAP. */
  async domains(input: { organizationId: string; from?: string; to?: string }) {
    const { from, to } = resolveWindow(input);
    const events = await prisma.emailEvent.findMany({
      where: {
        organizationId: input.organizationId,
        occurredAt: { gte: from, lte: to }
      },
      select: { type: true, emailJob: { select: { toEmail: true } } },
      orderBy: { occurredAt: "desc" },
      take: DOMAIN_SCAN_CAP + 1
    });

    const truncated = events.length > DOMAIN_SCAN_CAP;
    const scanned = truncated ? events.slice(0, DOMAIN_SCAN_CAP) : events;

    const byDomain = new Map<
      string,
      { sent: number; delivered: number; bounced: number; complained: number }
    >();
    for (const event of scanned) {
      const domain = recipientDomain(event.emailJob.toEmail);
      const row =
        byDomain.get(domain) ??
        { sent: 0, delivered: 0, bounced: 0, complained: 0 };
      if (event.type === "SENT") row.sent += 1;
      else if (event.type === "DELIVERED") row.delivered += 1;
      else if (event.type === "BOUNCED") row.bounced += 1;
      else if (event.type === "COMPLAINED") row.complained += 1;
      byDomain.set(domain, row);
    }

    const domains = [...byDomain.entries()]
      .map(([domain, row]) => ({
        domain,
        ...row,
        bounceRate: rate(row.bounced, row.sent),
        complaintRate: rate(row.complained, row.sent)
      }))
      .sort((a, b) => b.sent - a.sent);

    return { truncated, domains };
  },

  /** Structured reputation alerts derived from the overview rates. */
  async alerts(input: { organizationId: string; from?: string; to?: string }) {
    const overview = await this.overview(input);
    const alerts: Array<{
      level: "warning" | "critical";
      metric: string;
      value: number;
      threshold: number;
      message: string;
    }> = [];

    if (overview.rates.bounce > BOUNCE_RATE_ALERT) {
      alerts.push({
        level: "critical",
        metric: "bounceRate",
        value: overview.rates.bounce,
        threshold: BOUNCE_RATE_ALERT,
        message:
          "Bounce rate is above 5%. Clean your list and verify addresses to protect sender reputation."
      });
    }
    if (overview.rates.complaint > COMPLAINT_RATE_ALERT) {
      alerts.push({
        level: "critical",
        metric: "complaintRate",
        value: overview.rates.complaint,
        threshold: COMPLAINT_RATE_ALERT,
        message:
          "Complaint rate is above 0.1%. Review targeting and unsubscribe handling."
      });
    }

    return { alerts };
  }
};
