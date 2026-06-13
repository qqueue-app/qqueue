// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { NotImplementedError } from "../../lib/http-error.js";
import { billingService } from "./service.js";

describe("billingService", () => {
  it("returns the plan catalog", () => {
    expect(billingService.listPlans().map((p) => p.key)).toContain("pro");
  });

  it("looks up a subscription by organization", async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      organizationId: "org_1",
      planKey: "pro"
    } as never);

    const sub = await billingService.getSubscription("org_1");

    expect(sub?.planKey).toBe("pro");
    expect(prismaMock.subscription.findUnique).toHaveBeenCalledWith({
      where: { organizationId: "org_1" }
    });
  });

  describe("ensureSubscription", () => {
    it("returns the existing subscription without creating", async () => {
      prismaMock.subscription.findUnique.mockResolvedValue({
        organizationId: "org_1",
        planKey: "scale"
      } as never);

      const sub = await billingService.ensureSubscription("org_1");

      expect(sub.planKey).toBe("scale");
      expect(prismaMock.subscription.create).not.toHaveBeenCalled();
    });

    it("creates a free trialing subscription when none exists", async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null as never);
      prismaMock.subscription.create.mockResolvedValue({
        organizationId: "org_1",
        planKey: "free"
      } as never);

      await billingService.ensureSubscription("org_1");

      expect(prismaMock.subscription.create).toHaveBeenCalledWith({
        data: { organizationId: "org_1", planKey: "free" }
      });
    });
  });

  describe("getPlanForOrganization", () => {
    it("returns the stored plan when it is a known catalog key", async () => {
      prismaMock.subscription.findUnique.mockResolvedValue({
        planKey: "pro"
      } as never);

      expect(await billingService.getPlanForOrganization("org_1")).toBe("pro");
    });

    it("falls back to free when there is no subscription", async () => {
      prismaMock.subscription.findUnique.mockResolvedValue(null as never);

      expect(await billingService.getPlanForOrganization("org_1")).toBe("free");
    });

    it("falls back to free when the stored plan is no longer in the catalog", async () => {
      prismaMock.subscription.findUnique.mockResolvedValue({
        planKey: "legacy_enterprise"
      } as never);

      expect(await billingService.getPlanForOrganization("org_1")).toBe("free");
    });
  });

  it("checkout and provider webhook handling are not implemented yet", () => {
    expect(() => billingService.createCheckoutSession()).toThrow(
      NotImplementedError
    );
    expect(() => billingService.handleProviderWebhook()).toThrow(
      NotImplementedError
    );
  });
});
