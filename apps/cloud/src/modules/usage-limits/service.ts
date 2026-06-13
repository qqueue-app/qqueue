// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { prisma } from "../../lib/prisma.js";
import { getPlan, type PlanEntitlements, type PlanKey } from "../../plans/catalog.js";
import { billingService } from "../billing/service.js";

// A point-in-time snapshot of a tenant's metered usage. Sourced from the
// UsageCounter store; kept as a plain input so the evaluation logic stays pure.
export interface UsageSnapshot {
  emailsThisMonth: number;
  contacts: number;
  apiCallsThisMonth: number;
  seats: number;
}

export interface ResourceUsage {
  resource: keyof UsageSnapshot;
  used: number;
  limit: number | null;
  remaining: number | null;
  exceeded: boolean;
}

// The metered resource keys persisted in UsageCounter.resource, mapped to the
// snapshot field they populate and the plan entitlement they are checked against.
const RESOURCE_MAP: Array<{
  counter: string;
  resource: keyof UsageSnapshot;
  limit: keyof PlanEntitlements;
}> = [
  { counter: "emails", resource: "emailsThisMonth", limit: "emailsPerMonth" },
  { counter: "contacts", resource: "contacts", limit: "contacts" },
  { counter: "apiCalls", resource: "apiCallsThisMonth", limit: "apiCallsPerMonth" },
  { counter: "seats", resource: "seats", limit: "seats" }
];

// Pure quota evaluation. Compares a usage snapshot against a plan's entitlements
// and reports per-resource headroom. A null limit means unlimited (never
// exceeded). This is the core check the queue/worker enforcement layer will call
// before admitting work in a later slice.
export function evaluateUsage(
  snapshot: UsageSnapshot,
  planKey: PlanKey
): ResourceUsage[] {
  const { entitlements } = getPlan(planKey);

  return RESOURCE_MAP.map(({ resource, limit }) => {
    const used = snapshot[resource];
    const max = entitlements[limit];

    if (max === null) {
      return { resource, used, limit: null, remaining: null, exceeded: false };
    }

    return {
      resource,
      used,
      limit: max,
      remaining: Math.max(0, max - used),
      exceeded: used > max
    };
  });
}

export function isOverQuota(snapshot: UsageSnapshot, planKey: PlanKey): boolean {
  return evaluateUsage(snapshot, planKey).some((r) => r.exceeded);
}

export const usageLimitsService = {
  evaluateUsage,
  isOverQuota,

  // Record metered usage for a tenant in a billing period, creating the counter
  // on first use. periodKey is the bucket (e.g. "2026-06" for monthly resources,
  // "lifetime" for cumulative ones).
  incrementUsage(
    organizationId: string,
    resource: string,
    periodKey: string,
    amount = 1
  ) {
    return prisma.usageCounter.upsert({
      where: {
        organizationId_periodKey_resource: { organizationId, periodKey, resource }
      },
      create: { organizationId, periodKey, resource, used: amount },
      update: { used: { increment: amount } }
    });
  },

  // Build a usage snapshot for a tenant/period from the persisted counters.
  // Missing counters default to zero.
  async loadSnapshot(
    organizationId: string,
    periodKey: string
  ): Promise<UsageSnapshot> {
    const counters = await prisma.usageCounter.findMany({
      where: { organizationId, periodKey }
    });
    const usedFor = (counter: string) =>
      counters.find((c) => c.resource === counter)?.used ?? 0;

    return {
      emailsThisMonth: usedFor("emails"),
      contacts: usedFor("contacts"),
      apiCallsThisMonth: usedFor("apiCalls"),
      seats: usedFor("seats")
    };
  },

  // Resolve a tenant's current usage evaluated against its effective plan.
  async getCurrentUsage(
    organizationId: string,
    periodKey: string
  ): Promise<ResourceUsage[]> {
    const [snapshot, planKey] = await Promise.all([
      this.loadSnapshot(organizationId, periodKey),
      billingService.getPlanForOrganization(organizationId)
    ]);
    return evaluateUsage(snapshot, planKey);
  }
};
