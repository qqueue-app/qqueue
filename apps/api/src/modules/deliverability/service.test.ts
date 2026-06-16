import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { deliverabilityService } from "./service.js";

describe("deliverabilityService.overview", () => {
  it("aggregates totals and rates with a hard/soft bounce split", async () => {
    prismaMock.emailEvent.groupBy
      .mockResolvedValueOnce([
        { type: "SENT", _count: { _all: 100 } },
        { type: "DELIVERED", _count: { _all: 90 } },
        { type: "BOUNCED", _count: { _all: 8 } },
        { type: "COMPLAINED", _count: { _all: 1 } }
      ] as never) // byType
      .mockResolvedValueOnce([{ emailJobId: "j1" }] as never) // unique opens
      .mockResolvedValueOnce([] as never); // unique clicks
    prismaMock.emailEvent.count
      .mockResolvedValueOnce(6 as never) // hard
      .mockResolvedValueOnce(2 as never); // soft
    prismaMock.suppression.count.mockResolvedValue(12 as never);

    const result = await deliverabilityService.overview({
      organizationId: "org_1"
    });

    expect(result.totals).toMatchObject({
      sent: 100,
      delivered: 90,
      bounced: 8,
      hardBounced: 6,
      softBounced: 2,
      complained: 1,
      suppressed: 12,
      opened: 1
    });
    expect(result.rates.delivery).toBeCloseTo(0.9);
    expect(result.rates.bounce).toBeCloseTo(0.08);
  });
});

describe("deliverabilityService.domains", () => {
  it("groups events by recipient domain and flags truncation", async () => {
    prismaMock.emailEvent.findMany.mockResolvedValue([
      { type: "SENT", emailJob: { toEmail: "a@gmail.com" } },
      { type: "SENT", emailJob: { toEmail: "b@gmail.com" } },
      { type: "BOUNCED", emailJob: { toEmail: "c@gmail.com" } },
      { type: "SENT", emailJob: { toEmail: "d@yahoo.com" } }
    ] as never);

    const result = await deliverabilityService.domains({
      organizationId: "org_1"
    });

    expect(result.truncated).toBe(false);
    const gmail = result.domains.find((d) => d.domain === "gmail.com");
    expect(gmail).toMatchObject({ sent: 2, bounced: 1 });
    // Highest sent domain first.
    expect(result.domains[0].domain).toBe("gmail.com");
  });
});

describe("deliverabilityService.alerts", () => {
  it("raises critical alerts when bounce/complaint rates exceed thresholds", async () => {
    prismaMock.emailEvent.groupBy
      .mockResolvedValueOnce([
        { type: "SENT", _count: { _all: 100 } },
        { type: "BOUNCED", _count: { _all: 10 } },
        { type: "COMPLAINED", _count: { _all: 1 } }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    prismaMock.emailEvent.count.mockResolvedValue(0 as never);
    prismaMock.suppression.count.mockResolvedValue(0 as never);

    const result = await deliverabilityService.alerts({
      organizationId: "org_1"
    });

    const metrics = result.alerts.map((a) => a.metric);
    expect(metrics).toContain("bounceRate");
    expect(metrics).toContain("complaintRate");
  });

  it("returns no alerts when rates are healthy", async () => {
    prismaMock.emailEvent.groupBy
      .mockResolvedValueOnce([
        { type: "SENT", _count: { _all: 100 } },
        { type: "BOUNCED", _count: { _all: 1 } }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    prismaMock.emailEvent.count.mockResolvedValue(0 as never);
    prismaMock.suppression.count.mockResolvedValue(0 as never);

    const result = await deliverabilityService.alerts({
      organizationId: "org_1"
    });
    expect(result.alerts).toHaveLength(0);
  });
});
