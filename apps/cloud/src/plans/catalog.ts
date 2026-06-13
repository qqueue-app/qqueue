// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng

// Plan catalog for QQueue Cloud. These tiers and entitlements are PLACEHOLDER
// values for the Phase 7 scaffold; final pricing and limits are decided with the
// commercial license review before launch. The catalog is the single source of
// truth that both billing (what to charge for) and usage limits (what to
// enforce) read from.

export type PlanKey = "free" | "pro" | "scale";

// Per-plan entitlements. `null` means unlimited / not enforced.
export interface PlanEntitlements {
  emailsPerMonth: number | null;
  contacts: number | null;
  apiCallsPerMonth: number | null;
  seats: number | null;
}

export interface Plan {
  key: PlanKey;
  name: string;
  entitlements: PlanEntitlements;
}

export const PLAN_CATALOG: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    entitlements: {
      emailsPerMonth: 1_000,
      contacts: 500,
      apiCallsPerMonth: 1_000,
      seats: 1
    }
  },
  pro: {
    key: "pro",
    name: "Pro",
    entitlements: {
      emailsPerMonth: 50_000,
      contacts: 25_000,
      apiCallsPerMonth: 100_000,
      seats: 5
    }
  },
  scale: {
    key: "scale",
    name: "Scale",
    entitlements: {
      emailsPerMonth: 500_000,
      contacts: 250_000,
      apiCallsPerMonth: 1_000_000,
      seats: 25
    }
  }
};

export function listPlans(): Plan[] {
  return Object.values(PLAN_CATALOG);
}

export function isPlanKey(value: string): value is PlanKey {
  return value in PLAN_CATALOG;
}

export function getPlan(key: string): Plan {
  if (!isPlanKey(key)) {
    throw new Error(`Unknown plan: ${key}`);
  }
  return PLAN_CATALOG[key];
}
