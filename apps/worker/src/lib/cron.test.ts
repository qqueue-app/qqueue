import { describe, expect, it } from "vitest";
import { nextCronRun } from "./cron.js";

describe("nextCronRun", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");

  it("returns the next fire time for a valid expression", () => {
    // Every day at midnight UTC -> next fire is the following midnight.
    const next = nextCronRun("0 0 * * *", "UTC", from);
    expect(next).toBeInstanceOf(Date);
    expect(next?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("defaults to UTC when timezone is null", () => {
    const next = nextCronRun("0 0 * * *", null, from);
    expect(next?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("defaults to UTC when timezone is undefined", () => {
    const next = nextCronRun("0 0 * * *", undefined, from);
    expect(next?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("honors a non-UTC timezone", () => {
    // Midnight in New York (UTC-5 in January) is 05:00 UTC.
    const next = nextCronRun("0 0 * * *", "America/New_York", from);
    expect(next?.toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });

  it("returns null for an invalid expression", () => {
    expect(nextCronRun("not a cron", "UTC", from)).toBeNull();
  });

  it("returns null for an invalid timezone", () => {
    expect(nextCronRun("0 0 * * *", "Not/AZone", from)).toBeNull();
  });

  it("uses the current date when no 'from' is given", () => {
    const next = nextCronRun("* * * * *", "UTC");
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });
});
