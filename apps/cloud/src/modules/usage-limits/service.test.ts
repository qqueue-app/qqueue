// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import {
  evaluateUsage,
  isOverQuota,
  usageLimitsService,
  type UsageSnapshot
} from "./service.js";

const underFreeLimits: UsageSnapshot = {
  emailsThisMonth: 100,
  contacts: 50,
  apiCallsThisMonth: 100,
  seats: 1
};

describe("evaluateUsage", () => {
  it("reports headroom when under limits", () => {
    const result = evaluateUsage(underFreeLimits, "free");
    const emails = result.find((r) => r.resource === "emailsThisMonth")!;
    expect(emails.limit).toBe(1_000);
    expect(emails.remaining).toBe(900);
    expect(emails.exceeded).toBe(false);
  });

  it("flags a resource that exceeds its limit", () => {
    const result = evaluateUsage(
      { ...underFreeLimits, emailsThisMonth: 5_000 },
      "free"
    );
    const emails = result.find((r) => r.resource === "emailsThisMonth")!;
    expect(emails.exceeded).toBe(true);
    expect(emails.remaining).toBe(0);
  });

  it("treats usage exactly at the limit as not exceeded", () => {
    const result = evaluateUsage({ ...underFreeLimits, contacts: 500 }, "free");
    const contacts = result.find((r) => r.resource === "contacts")!;
    expect(contacts.exceeded).toBe(false);
    expect(contacts.remaining).toBe(0);
  });
});

describe("isOverQuota", () => {
  it("is false when every resource is within limits", () => {
    expect(isOverQuota(underFreeLimits, "free")).toBe(false);
  });

  it("is true when any resource is over its limit", () => {
    expect(isOverQuota({ ...underFreeLimits, seats: 99 }, "free")).toBe(true);
  });
});

describe("usageLimitsService.incrementUsage", () => {
  it("upserts the counter, incrementing on conflict", async () => {
    prismaMock.usageCounter.upsert.mockResolvedValue({} as never);

    await usageLimitsService.incrementUsage("org_1", "emails", "2026-06", 5);

    expect(prismaMock.usageCounter.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_periodKey_resource: {
          organizationId: "org_1",
          periodKey: "2026-06",
          resource: "emails"
        }
      },
      create: {
        organizationId: "org_1",
        periodKey: "2026-06",
        resource: "emails",
        used: 5
      },
      update: { used: { increment: 5 } }
    });
  });

  it("defaults the increment amount to 1", async () => {
    prismaMock.usageCounter.upsert.mockResolvedValue({} as never);

    await usageLimitsService.incrementUsage("org_1", "apiCalls", "2026-06");

    expect(prismaMock.usageCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ used: 1 }),
        update: { used: { increment: 1 } }
      })
    );
  });
});

describe("usageLimitsService.loadSnapshot", () => {
  it("maps counters into a snapshot and defaults missing resources to zero", async () => {
    prismaMock.usageCounter.findMany.mockResolvedValue([
      { resource: "emails", used: 200 },
      { resource: "apiCalls", used: 30 }
    ] as never);

    const snapshot = await usageLimitsService.loadSnapshot("org_1", "2026-06");

    expect(snapshot).toEqual({
      emailsThisMonth: 200,
      contacts: 0,
      apiCallsThisMonth: 30,
      seats: 0
    });
  });
});

describe("usageLimitsService.getCurrentUsage", () => {
  it("evaluates persisted usage against the tenant's effective plan", async () => {
    prismaMock.usageCounter.findMany.mockResolvedValue([
      { resource: "emails", used: 60_000 }
    ] as never);
    // Effective plan resolves via billingService -> subscription lookup.
    prismaMock.subscription.findUnique.mockResolvedValue({
      planKey: "pro"
    } as never);

    const usage = await usageLimitsService.getCurrentUsage("org_1", "2026-06");
    const emails = usage.find((r) => r.resource === "emailsThisMonth")!;

    expect(emails.limit).toBe(50_000); // pro plan
    expect(emails.exceeded).toBe(true);
  });
});
