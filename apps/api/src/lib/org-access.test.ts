import { describe, expect, it } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { HttpError } from "./http-error.js";
import { assertOrgAccess, assertOrgRole, getMembership } from "./org-access.js";

describe("getMembership", () => {
  it("queries by the composite organizationId_userId key", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);

    const result = await getMembership("user_1", "org_1");
    expect(result).toEqual({ role: "OWNER" });
    expect(prismaMock.organizationMember.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org_1", userId: "user_1" } }
    });
  });
});

describe("assertOrgAccess", () => {
  it("returns the membership when found", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    await expect(assertOrgAccess("user_1", "org_1")).resolves.toEqual({
      role: "MEMBER"
    });
  });

  it("throws 403 when there is no membership", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    await expect(assertOrgAccess("user_1", "org_1")).rejects.toThrow(HttpError);
    await expect(assertOrgAccess("user_1", "org_1")).rejects.toThrow(
      "You do not have access to this organization"
    );
  });
});

describe("assertOrgRole", () => {
  it("returns the membership when the role matches", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN"
    } as never);
    await expect(
      assertOrgRole("user_1", "org_1", ["OWNER", "ADMIN"])
    ).resolves.toEqual({ role: "ADMIN" });
  });

  it("throws 403 when the role is not permitted", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    await expect(
      assertOrgRole("user_1", "org_1", ["OWNER"])
    ).rejects.toThrow("You do not have permission to do this");
  });

  it("propagates the 403 from assertOrgAccess when not a member", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    await expect(
      assertOrgRole("user_1", "org_1", ["OWNER"])
    ).rejects.toThrow("You do not have access to this organization");
  });
});
