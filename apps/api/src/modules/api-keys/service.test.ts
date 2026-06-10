import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { apiKeyService, hashApiKey } from "./service.js";

describe("apiKeyService", () => {
  it("lists keys for an accessible organization", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.apiKey.findMany.mockResolvedValue([] as never);

    const result = await apiKeyService.list("org_1", "user_1");

    expect(result).toEqual([]);
    expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1" } })
    );
  });

  it("creates a key and only stores its hash", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.apiKey.create.mockResolvedValue({
      id: "key_1",
      organizationId: "org_1",
      userId: "user_1",
      name: "Production"
    } as never);

    const result = await apiKeyService.create(
      { organizationId: "org_1", name: "Production" },
      "user_1"
    );

    expect(result.key).toMatch(/^qq_live_/);
    expect(result.apiKey).toMatchObject({ id: "key_1" });
    const createArgs = prismaMock.apiKey.create.mock.calls[0][0];
    expect(createArgs.data.keyHash).toBe(hashApiKey(result.key));
    expect(createArgs.data).not.toHaveProperty("key");
  });

  it("revokes a key when the user can administer its organization", async () => {
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: "key_1",
      organizationId: "org_1"
    } as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN"
    } as never);
    prismaMock.apiKey.update.mockResolvedValue({ id: "key_1" } as never);

    await apiKeyService.revoke("key_1", "user_1");

    expect(prismaMock.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key_1" },
        data: { revokedAt: expect.any(Date) }
      })
    );
  });

  it("authenticates a valid non-revoked API key and records last use", async () => {
    const key = "qq_live_valid";
    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: "key_1",
      organizationId: "org_1"
    } as never);
    prismaMock.apiKey.update.mockResolvedValue({ id: "key_1" } as never);

    const result = await apiKeyService.authenticate(key);

    expect(result).toEqual({ id: "key_1", organizationId: "org_1" });
    expect(prismaMock.apiKey.findFirst).toHaveBeenCalledWith({
      where: { keyHash: hashApiKey(key), revokedAt: null },
      select: { id: true, organizationId: true }
    });
    expect(prismaMock.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key_1" },
        data: { lastUsedAt: expect.any(Date) }
      })
    );
  });

  it("rejects keys with an unknown prefix", async () => {
    const result = await apiKeyService.authenticate("not_a_qqueue_key");

    expect(result).toBeNull();
    expect(prismaMock.apiKey.findFirst).not.toHaveBeenCalled();
  });
});
