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
});
