import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { organizationService } from "./service.js";

describe("organizationService", () => {
  it("lists the organizations the user belongs to with their role", async () => {
    prismaMock.organizationMember.findMany.mockResolvedValue([
      {
        role: "OWNER",
        organization: { id: "org_1", name: "Acme", createdAt: new Date(0) }
      }
    ] as never);

    const result = await organizationService.list("user_1");
    expect(result).toEqual([
      { id: "org_1", name: "Acme", createdAt: new Date(0), role: "OWNER" }
    ]);
  });

  it("gets an organization after asserting access", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue({ id: "org_1" } as never);

    const result = await organizationService.get("org_1", "user_1");
    expect(result).toEqual({ id: "org_1" });
  });

  it("throws 403 getting an organization the user cannot access", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    await expect(organizationService.get("org_1", "user_1")).rejects.toThrow(
      "You do not have access to this organization"
    );
  });

  it("creates an organization owned by the creator", async () => {
    prismaMock.organization.create.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);
    const result = await organizationService.create({ name: "Acme" }, "user_1");
    expect(result).toEqual({ id: "org_1", name: "Acme", role: "OWNER" });
  });

  it("updates an organization when the user is OWNER/ADMIN", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN"
    } as never);
    prismaMock.organization.update.mockResolvedValue({ id: "org_1" } as never);
    await organizationService.update("org_1", "user_1", { name: "New" });
    expect(prismaMock.organization.update).toHaveBeenCalled();
  });

  it("throws 403 updating without OWNER/ADMIN role", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    await expect(
      organizationService.update("org_1", "user_1", { name: "New" })
    ).rejects.toThrow("You do not have permission to do this");
  });

  it("deletes an organization when the user is OWNER", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organization.delete.mockResolvedValue({ id: "org_1" } as never);
    await organizationService.delete("org_1", "user_1");
    expect(prismaMock.organization.delete).toHaveBeenCalledWith({
      where: { id: "org_1" }
    });
  });

  it("throws 403 deleting without OWNER role", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN"
    } as never);
    await expect(organizationService.delete("org_1", "user_1")).rejects.toThrow(
      "You do not have permission to do this"
    );
  });

  describe("updateMemberRole", () => {
    it("lets an OWNER promote a MEMBER to ADMIN", async () => {
      // First findUnique = actor membership, second = target membership.
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "OWNER" } as never)
        .mockResolvedValueOnce({ role: "MEMBER" } as never);
      prismaMock.organizationMember.update.mockResolvedValue({
        userId: "target",
        role: "ADMIN"
      } as never);

      const result = await organizationService.updateMemberRole(
        "org_1",
        "target",
        "actor",
        "ADMIN"
      );
      expect(result).toMatchObject({ role: "ADMIN" });
      expect(prismaMock.organizationMember.update).toHaveBeenCalled();
    });

    it("forbids an ADMIN from changing an OWNER's role", async () => {
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "ADMIN" } as never)
        .mockResolvedValueOnce({ role: "OWNER" } as never);

      await expect(
        organizationService.updateMemberRole("org_1", "target", "actor", "MEMBER")
      ).rejects.toThrow("Admins cannot change an owner's role");
    });

    it("forbids an ADMIN from granting the OWNER role", async () => {
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "ADMIN" } as never)
        .mockResolvedValueOnce({ role: "MEMBER" } as never);

      await expect(
        organizationService.updateMemberRole("org_1", "target", "actor", "OWNER")
      ).rejects.toThrow("Only an owner can grant the owner role");
    });

    it("refuses to demote the last remaining OWNER", async () => {
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "OWNER" } as never)
        .mockResolvedValueOnce({ role: "OWNER" } as never);
      prismaMock.organizationMember.count.mockResolvedValue(1);

      await expect(
        organizationService.updateMemberRole("org_1", "target", "actor", "MEMBER")
      ).rejects.toThrow("at least one owner");
    });

    it("returns 404 when the target is not a member", async () => {
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "OWNER" } as never)
        .mockResolvedValueOnce(null);

      await expect(
        organizationService.updateMemberRole("org_1", "ghost", "actor", "ADMIN")
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("removeMember", () => {
    it("lets an OWNER remove a MEMBER", async () => {
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "OWNER" } as never)
        .mockResolvedValueOnce({ role: "MEMBER" } as never);
      prismaMock.organizationMember.delete.mockResolvedValue({} as never);

      await organizationService.removeMember("org_1", "target", "actor");
      expect(prismaMock.organizationMember.delete).toHaveBeenCalledWith({
        where: { organizationId_userId: { organizationId: "org_1", userId: "target" } }
      });
    });

    it("forbids an ADMIN from removing an OWNER", async () => {
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "ADMIN" } as never)
        .mockResolvedValueOnce({ role: "OWNER" } as never);

      await expect(
        organizationService.removeMember("org_1", "target", "actor")
      ).rejects.toThrow("Admins cannot remove an owner");
    });

    it("refuses to remove the last remaining OWNER", async () => {
      prismaMock.organizationMember.findUnique
        .mockResolvedValueOnce({ role: "OWNER" } as never)
        .mockResolvedValueOnce({ role: "OWNER" } as never);
      prismaMock.organizationMember.count.mockResolvedValue(1);

      await expect(
        organizationService.removeMember("org_1", "target", "actor")
      ).rejects.toThrow("at least one owner");
    });
  });
});
