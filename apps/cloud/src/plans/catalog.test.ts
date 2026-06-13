// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { describe, expect, it } from "vitest";
import { getPlan, isPlanKey, listPlans, PLAN_CATALOG } from "./catalog.js";

describe("plan catalog", () => {
  it("lists every plan in the catalog", () => {
    const plans = listPlans();
    expect(plans).toHaveLength(Object.keys(PLAN_CATALOG).length);
    expect(plans.map((p) => p.key)).toEqual(["free", "pro", "scale"]);
  });

  it("recognizes valid plan keys", () => {
    expect(isPlanKey("pro")).toBe(true);
    expect(isPlanKey("enterprise")).toBe(false);
  });

  it("returns a plan by key", () => {
    expect(getPlan("free").name).toBe("Free");
  });

  it("throws on an unknown plan key", () => {
    expect(() => getPlan("nope")).toThrow(/Unknown plan/);
  });

  it("orders entitlements free < pro < scale", () => {
    expect(PLAN_CATALOG.free.entitlements.emailsPerMonth!).toBeLessThan(
      PLAN_CATALOG.pro.entitlements.emailsPerMonth!
    );
    expect(PLAN_CATALOG.pro.entitlements.emailsPerMonth!).toBeLessThan(
      PLAN_CATALOG.scale.entitlements.emailsPerMonth!
    );
  });
});
