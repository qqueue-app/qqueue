import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { suppressionService } from "./service.js";

describe("suppressionService", () => {
  it("lists suppressions for an organization, newest first", () => {
    prismaMock.suppression.findMany.mockResolvedValue([] as never);
    suppressionService.list("org_1");
    expect(prismaMock.suppression.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: { createdAt: "desc" }
    });
  });

  it("upserts on (organizationId, email) so re-suppressing is idempotent", () => {
    prismaMock.suppression.upsert.mockResolvedValue({ id: "s1" } as never);
    suppressionService.addSuppression({
      organizationId: "org_1",
      email: "blocked@example.com",
      reason: "BOUNCE",
      source: "webhook"
    });
    const call = prismaMock.suppression.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      organizationId_email: {
        organizationId: "org_1",
        email: "blocked@example.com"
      }
    });
    expect(call.create).toMatchObject({ reason: "BOUNCE", source: "webhook" });
    expect(call.update).toMatchObject({ reason: "BOUNCE" });
  });

  it("reports whether an address is suppressed", async () => {
    prismaMock.suppression.findUnique.mockResolvedValue({ id: "s1" } as never);
    expect(await suppressionService.isSuppressed("org_1", "x@y.com")).toBe(true);

    prismaMock.suppression.findUnique.mockResolvedValue(null);
    expect(await suppressionService.isSuppressed("org_1", "x@y.com")).toBe(
      false
    );
  });

  it("removes a suppression scoped by membership", async () => {
    prismaMock.suppression.deleteMany.mockResolvedValue({ count: 1 } as never);
    await suppressionService.remove("s1", "user_1");
    expect(prismaMock.suppression.deleteMany).toHaveBeenCalledWith({
      where: { id: "s1", organization: { members: { some: { userId: "user_1" } } } }
    });
  });

  it("throws 404 removing a suppression the user does not own", async () => {
    prismaMock.suppression.deleteMany.mockResolvedValue({ count: 0 } as never);
    await expect(suppressionService.remove("s1", "user_1")).rejects.toThrow(
      "Suppression not found"
    );
  });

  describe("auto-suppression policy", () => {
    it("returns env defaults when no policy row exists", async () => {
      prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null as never);
      const policy = await suppressionService.getEffectivePolicy("org_1");
      expect(policy).toEqual({
        organizationId: "org_1",
        softBounceThreshold: 3,
        softBounceWindowDays: 30
      });
    });

    it("returns the org's row when present", async () => {
      prismaMock.suppressionPolicy.findUnique.mockResolvedValue({
        organizationId: "org_1",
        softBounceThreshold: 5,
        softBounceWindowDays: 14
      } as never);
      const policy = await suppressionService.getEffectivePolicy("org_1");
      expect(policy).toMatchObject({
        softBounceThreshold: 5,
        softBounceWindowDays: 14
      });
    });

    it("upserts the policy on (organizationId)", () => {
      prismaMock.suppressionPolicy.upsert.mockResolvedValue({} as never);
      suppressionService.upsertPolicy({
        organizationId: "org_1",
        softBounceThreshold: 4,
        softBounceWindowDays: 7
      });
      const call = prismaMock.suppressionPolicy.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ organizationId: "org_1" });
      expect(call.create).toMatchObject({ softBounceThreshold: 4 });
    });

    it("suppresses hard/block bounces without counting", async () => {
      expect(
        await suppressionService.shouldSuppressBounce({
          organizationId: "org_1",
          email: "x@y.com",
          bounceType: "HARD"
        })
      ).toBe(true);
      expect(
        await suppressionService.shouldSuppressBounce({
          organizationId: "org_1",
          email: "x@y.com",
          bounceType: "BLOCK"
        })
      ).toBe(true);
      expect(prismaMock.emailEvent.count).not.toHaveBeenCalled();
    });

    it("suppresses a soft bounce only at/above the threshold", async () => {
      prismaMock.suppressionPolicy.findUnique.mockResolvedValue(null as never);

      prismaMock.emailEvent.count.mockResolvedValue(2 as never);
      expect(
        await suppressionService.shouldSuppressBounce({
          organizationId: "org_1",
          email: "x@y.com",
          bounceType: "SOFT"
        })
      ).toBe(false);

      prismaMock.emailEvent.count.mockResolvedValue(3 as never);
      expect(
        await suppressionService.shouldSuppressBounce({
          organizationId: "org_1",
          email: "x@y.com",
          bounceType: "SOFT"
        })
      ).toBe(true);
    });
  });
});
