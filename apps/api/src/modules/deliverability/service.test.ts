import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { deliverabilityService } from "./service.js";

/**
 * These tests describe scenarios the *pipeline can actually produce*, not
 * arbitrary numbers.
 *
 * The previous suite hand-fed `{ sent: 100, bounced: 8 }` and asserted 8%. That
 * pair is unreachable: when SMTP rejects a recipient the send worker writes a
 * BOUNCED event and returns before writing SENT, so bounces are missing from
 * the very population they were being divided by. The arithmetic was right and
 * the answer was wrong, which is exactly what a mocked test can hide unless the
 * fixture is built from what the writers emit.
 *
 * `stubOverview` therefore takes a job-status census — the shape `groupBy` over
 * EmailJob genuinely returns — and distinct-job counts in the exact order
 * `overview` awaits them.
 */
function stubOverview(input: {
  jobs: Partial<Record<string, number>>;
  /**
   * Of `jobs.FAILED`, how many failed *before* a recipient's mail server saw
   * the message. The rest are bounces. Defaults to 0, which pairs with a
   * fixture whose FAILED count equals its `bounced` count — the shape the send
   * worker produces when every failure was an SMTP rejection.
   */
  failedBeforeHandoff?: number;
  confirmedDelivered?: number;
  hasDeliverySignal?: boolean;
  bounced?: number;
  hard?: number;
  soft?: number;
  block?: number;
  complained?: number;
  opened?: number;
  clicked?: number;
  suppressedInWindow?: number;
  suppressedTotal?: number;
}) {
  prismaMock.emailJob.groupBy.mockResolvedValue(
    Object.entries(input.jobs).map(([status, count]) => ({
      status,
      _count: { _all: count }
    })) as never
  );

  // Every distinct-job count goes through emailEvent.groupBy, in the order the
  // service awaits them.
  const jobRows = (n = 0) =>
    Array.from({ length: n }, (_, i) => ({ emailJobId: `job_${i}` }));
  prismaMock.emailEvent.groupBy
    .mockResolvedValueOnce(jobRows(input.confirmedDelivered) as never)
    .mockResolvedValueOnce(jobRows(input.bounced) as never)
    .mockResolvedValueOnce(jobRows(input.hard) as never)
    .mockResolvedValueOnce(jobRows(input.soft) as never)
    .mockResolvedValueOnce(jobRows(input.block) as never)
    .mockResolvedValueOnce(jobRows(input.complained) as never)
    .mockResolvedValueOnce(jobRows(input.opened) as never)
    .mockResolvedValueOnce(jobRows(input.clicked) as never);

  prismaMock.emailJob.count.mockResolvedValue(
    (input.failedBeforeHandoff ?? 0) as never
  );

  prismaMock.emailEvent.findFirst.mockResolvedValue(
    (input.hasDeliverySignal ? { id: "evt_1" } : null) as never
  );
  prismaMock.suppression.count
    .mockResolvedValueOnce((input.suppressedInWindow ?? 0) as never)
    .mockResolvedValueOnce((input.suppressedTotal ?? 0) as never);
}

describe("deliverabilityService.overview", () => {
  it("counts a rejected send in the denominator it bounced out of", async () => {
    // The pipeline-truthful shape of "100 attempts, 50 rejected at SMTP": the
    // worker flips those 50 jobs to FAILED and writes one BOUNCED event each,
    // and writes no SENT event at all for them.
    stubOverview({
      jobs: { SENT: 50, FAILED: 50 },
      bounced: 50,
      hard: 50
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals.attempted).toBe(100);
    // The bug this replaced: bounced/sent = 50/50 reported a 100% bounce rate.
    expect(result.rates.bounce).toBeCloseTo(0.5);
    expect(result.rates.accepted).toBeCloseTo(0.5);
  });

  it("counts a recipient that bounced twice once", async () => {
    // One address can produce a synchronous SMTP bounce and a later DSN for the
    // same send. Counting events would make it two.
    stubOverview({ jobs: { SENT: 9, FAILED: 1 }, bounced: 1, hard: 1 });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals.bounced).toBe(1);
    expect(result.rates.bounce).toBeCloseTo(0.1);
  });

  it("excludes suppressed and cancelled recipients from the denominator", async () => {
    stubOverview({
      jobs: { SENT: 40, FAILED: 10, SUPPRESSED: 25, CANCELLED: 5, QUEUED: 7 },
      // All ten failures were SMTP rejections, so all ten reached a recipient
      // server and belong in `attempted`. See the pre-handoff tests below for
      // the other kind.
      bounced: 10
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    // Never attempted, so they belong to neither side of a delivery rate.
    expect(result.totals.attempted).toBe(50);
    expect(result.totals.suppressedAtSend).toBe(25);
    expect(result.totals.cancelled).toBe(5);
    expect(result.totals.inFlight).toBe(7);
    expect(result.rates.accepted).toBeCloseTo(0.8);
  });

  it("reports no delivery rate when nothing can confirm delivery", async () => {
    stubOverview({
      jobs: { SENT: 100 },
      opened: 30,
      hasDeliverySignal: false
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.deliverySignal).toBe("none");
    // The headline defect: with no ESP webhook the only DELIVERED events were
    // synthesized by the open pixel, so this read 30% and looked like failure.
    expect(result.rates.confirmedDelivery).toBeNull();
    expect(result.rates.open).toBeCloseTo(0.3);
  });

  it("reports a delivery rate once a real source has confirmed one", async () => {
    stubOverview({
      jobs: { SENT: 100 },
      confirmedDelivered: 94,
      hasDeliverySignal: true
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.deliverySignal).toBe("confirmed");
    expect(result.rates.confirmedDelivery).toBeCloseTo(0.94);
  });

  it("returns null rather than 0% when there is no denominator", async () => {
    stubOverview({ jobs: {} });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals.attempted).toBe(0);
    expect(result.rates.accepted).toBeNull();
    expect(result.rates.bounce).toBeNull();
    expect(result.rates.open).toBeNull();
  });

  it("splits bounces into hard, soft and block", async () => {
    // BLOCK is a real class from classifyBounce; the old tiles showed only
    // hard and soft, so blocked mail vanished from the breakdown.
    stubOverview({
      jobs: { SENT: 90, FAILED: 10 },
      bounced: 10,
      hard: 5,
      soft: 3,
      block: 2
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals).toMatchObject({
      bounced: 10,
      hardBounced: 5,
      softBounced: 3,
      blockBounced: 2
    });
  });

  it("scopes suppression growth to the window but keeps the total", async () => {
    stubOverview({
      jobs: { SENT: 10 },
      suppressedInWindow: 4,
      suppressedTotal: 137
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals.suppressedInWindow).toBe(4);
    expect(result.totals.suppressedTotal).toBe(137);
  });

  it("keeps sends that never reached a mail server out of the denominator", async () => {
    // An SMTP outage mid-send: 50 of 100 jobs threw before handoff, and the 50
    // that got out produced 5 bounces. No recipient server ever saw the 50, so
    // they are not evidence about how recipients treat this sender.
    stubOverview({
      jobs: { SENT: 45, FAILED: 55 },
      failedBeforeHandoff: 50,
      bounced: 5
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals.failedBeforeHandoff).toBe(50);
    expect(result.totals.failed).toBe(55);
    // 45 sent + 5 that bounced out of a real server, not 100.
    expect(result.totals.attempted).toBe(50);
    // The defect: 5/100 read as 5.0%, comfortably under the alert line, while
    // the true rate was double that.
    expect(result.rates.bounce).toBeCloseTo(0.1);
    // ...and "accepted" no longer blames receiving servers for our own outage.
    expect(result.rates.accepted).toBeCloseTo(0.9);
    // The excluded population stays visible instead of silently disappearing.
    expect(result.rates.deliveryFailure).toBeCloseTo(0.5);
  });

  it("treats a failure that bounced as attempted, not as a pre-handoff failure", async () => {
    // Every FAILED job here carries a BOUNCED event, so nothing is excluded.
    stubOverview({
      jobs: { SENT: 90, FAILED: 10 },
      failedBeforeHandoff: 0,
      bounced: 10
    });

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals.attempted).toBe(100);
    expect(result.rates.deliveryFailure).toBe(0);
  });

  it("counts reputation numerators over the terminal cohort only", async () => {
    stubOverview({ jobs: { SENT: 10 } });

    await deliverabilityService.overview({ organizationId: "org_1" });

    // The bounce lookup (call 2, after confirmed-delivery) must constrain the
    // job to a terminal status: a bounce recorded against a job that ended up
    // SUPPRESSED would otherwise sit in the numerator while its denominator
    // excluded it, and the rate could exceed 100%.
    const bounceCall = prismaMock.emailEvent.groupBy.mock.calls[1][0] as {
      where: { emailJob: { status?: { in: string[] } } };
    };
    expect(bounceCall.where.emailJob.status).toEqual({
      in: ["SENT", "FAILED"]
    });
  });

  it("anchors the cohort on send time, falling back to creation", async () => {
    stubOverview({ jobs: { SENT: 1 } });

    await deliverabilityService.overview({
      organizationId: "org_1",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z"
    });

    const where = prismaMock.emailJob.groupBy.mock.calls[0][0].where as {
      organizationId: string;
      OR: Array<Record<string, unknown>>;
    };
    expect(where.organizationId).toBe("org_1");
    // A DSN arriving in February for a January send must score against January.
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toHaveProperty("sentAt");
    expect(where.OR[1]).toMatchObject({ sentAt: null });
  });
});

describe("deliverabilityService.domains", () => {
  it("returns a per-domain funnel aggregated in SQL", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        domain: "gmail.com",
        attempted: 60n,
        sent: 56n,
        failedBeforeHandoff: 0n,
        bounced: 4n,
        complained: 1n
      },
      {
        domain: "yahoo.com",
        attempted: 10n,
        sent: 0n,
        failedBeforeHandoff: 0n,
        bounced: 10n,
        complained: 0n
      }
    ] as never);

    const result = await deliverabilityService.domains({
      organizationId: "org_1"
    });

    expect(result.domains[0]).toMatchObject({
      domain: "gmail.com",
      attempted: 60,
      sent: 56,
      bounced: 4
    });
    expect(result.domains[0].bounceRate).toBeCloseTo(4 / 60);
    // A domain where every attempt bounced. The scan-and-cap version could lose
    // this domain's sends to the 5,000-event cap while keeping its bounces,
    // then render `bounced / 0` as a reassuring 0.0%.
    expect(result.domains[1].bounceRate).toBeCloseTo(1);
  });

  it("counts bigints from Postgres as numbers", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        domain: "gmail.com",
        attempted: 3n,
        sent: 3n,
        failedBeforeHandoff: 0n,
        bounced: 0n,
        complained: 0n
      }
    ] as never);

    const result = await deliverabilityService.domains({
      organizationId: "org_1"
    });

    expect(result.domains[0].attempted).toBe(3);
    expect(typeof result.domains[0].attempted).toBe("number");
    expect(result.domains[0].bounceRate).toBe(0);
  });
});

describe("deliverabilityService.alerts", () => {
  it("raises critical alerts when bounce/complaint rates exceed thresholds", async () => {
    stubOverview({
      jobs: { SENT: 900, FAILED: 100 },
      bounced: 100,
      complained: 5
    });

    const result = await deliverabilityService.alerts({
      organizationId: "org_1"
    });

    const metrics = result.alerts.map((a) => a.metric);
    expect(metrics).toContain("bounceRate");
    expect(metrics).toContain("complaintRate");
  });

  it("raises the bounce alert an outage used to withhold", async () => {
    // 1000 recipients, 500 died before handoff, 50 of the 500 that got out
    // bounced. True rate 10%; the old SENT+FAILED denominator reported exactly
    // 5.0%, and `5.0 > 5.0` is false — so the critical alert never fired.
    stubOverview({
      jobs: { SENT: 450, FAILED: 550 },
      failedBeforeHandoff: 500,
      bounced: 50
    });

    const result = await deliverabilityService.alerts({
      organizationId: "org_1"
    });

    expect(result.alerts.map((a) => a.metric)).toContain("bounceRate");
  });

  it("stays quiet at healthy rates", async () => {
    stubOverview({ jobs: { SENT: 999, FAILED: 1 }, bounced: 1 });

    const result = await deliverabilityService.alerts({
      organizationId: "org_1"
    });
    expect(result.alerts).toHaveLength(0);
  });

  it("does not cry wolf on a handful of sends", async () => {
    // 2 of 5 bounced is 40%, far past the 5% line, and means nothing.
    stubOverview({ jobs: { SENT: 3, FAILED: 2 }, bounced: 2, complained: 1 });

    const result = await deliverabilityService.alerts({
      organizationId: "org_1"
    });
    expect(result.alerts).toHaveLength(0);
  });
});
