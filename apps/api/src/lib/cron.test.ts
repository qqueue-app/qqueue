import { describe, expect, it } from "vitest";
import { nextCronRun } from "./cron.js";

describe("nextCronRun", () => {
  it("returns the next fire time for a valid expression", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = nextCronRun("0 12 * * *", "UTC", from);
    expect(next).toBeInstanceOf(Date);
    expect(next?.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  it("defaults to UTC when timezone is null/undefined", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(nextCronRun("0 0 * * *", null, from)).toBeInstanceOf(Date);
    expect(nextCronRun("0 0 * * *", undefined, from)).toBeInstanceOf(Date);
  });

  it("returns null for an invalid cron expression", () => {
    expect(nextCronRun("not-a-cron", "UTC")).toBeNull();
  });

  it("returns null for an invalid timezone", () => {
    expect(nextCronRun("0 0 * * *", "Not/AZone")).toBeNull();
  });
});
