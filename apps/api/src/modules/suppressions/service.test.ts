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
});
