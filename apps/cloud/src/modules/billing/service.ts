// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { NotImplementedError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { isPlanKey, listPlans, type Plan, type PlanKey } from "../../plans/catalog.js";

// Billing service. Slice 1 wires the subscription data model; the payment
// provider (Stripe) checkout and webhook handling remain NotImplemented and are
// the next sub-step. plan/pricing lives in the in-code catalog, so a plan change
// is not a migration.
export const billingService = {
  listPlans(): Plan[] {
    return listPlans();
  },

  getSubscription(organizationId: string) {
    return prisma.subscription.findUnique({ where: { organizationId } });
  },

  // Idempotently ensure a tenant has a subscription. New tenants default to the
  // free plan in a trialing state. Returns the existing or newly-created row.
  async ensureSubscription(organizationId: string, planKey: PlanKey = "free") {
    const existing = await prisma.subscription.findUnique({
      where: { organizationId }
    });
    if (existing) {
      return existing;
    }
    return prisma.subscription.create({ data: { organizationId, planKey } });
  },

  // Resolve the effective plan for a tenant. Falls back to "free" when there is
  // no subscription yet or the stored plan key is no longer in the catalog.
  async getPlanForOrganization(organizationId: string): Promise<PlanKey> {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId }
    });
    if (subscription && isPlanKey(subscription.planKey)) {
      return subscription.planKey;
    }
    return "free";
  },

  createCheckoutSession(): never {
    throw new NotImplementedError("Billing checkout");
  },

  handleProviderWebhook(): never {
    throw new NotImplementedError("Billing provider webhook handling");
  }
};
