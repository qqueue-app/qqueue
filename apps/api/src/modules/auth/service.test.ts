import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { hashPassword } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { createAuthTokens } from "../../lib/tokens.js";
import { authService } from "./service.js";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("authService.register", () => {
  it("creates the user and org in a transaction and returns tokens", async () => {
    prismaMock.user.create.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A",
      createdAt: now
    } as never);
    prismaMock.organization.create.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);

    const result = await authService.register({
      email: "a@b.com",
      password: "password123",
      name: "A",
      organizationName: "Acme"
    });

    expect(result.user).toEqual({
      id: "user_1",
      email: "a@b.com",
      name: "A",
      createdAt: now.toISOString()
    });
    expect(result.organization).toEqual({ id: "org_1", name: "Acme" });
    expect(result.tokens.accessToken).toEqual(expect.any(String));
    expect(prismaMock.user.create).toHaveBeenCalledOnce();
  });

  it("defaults the organization name when none is given", async () => {
    prismaMock.user.create.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: null,
      createdAt: now
    } as never);
    prismaMock.organization.create.mockResolvedValue({
      id: "org_1",
      name: "a@b.com's organization"
    } as never);

    await authService.register({ email: "a@b.com", password: "password123" });

    const call = prismaMock.organization.create.mock.calls[0][0];
    expect(call.data.name).toBe("a@b.com's organization");
  });
});

describe("authService.login", () => {
  it("returns user, organizations and tokens on valid credentials", async () => {
    const passwordHash = await hashPassword("password123");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A",
      passwordHash,
      createdAt: now,
      members: [{ organization: { id: "org_1", name: "Acme" }, role: "OWNER" }]
    } as never);

    const result = await authService.login({
      email: "a@b.com",
      password: "password123"
    });

    expect(result.organizations).toEqual([
      { id: "org_1", name: "Acme", role: "OWNER" }
    ]);
    expect(result.tokens.refreshToken).toEqual(expect.any(String));
  });

  it("throws 401 when the user does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(
      authService.login({ email: "missing@b.com", password: "password123" })
    ).rejects.toThrow(HttpError);
  });

  it("throws 401 when the password is wrong", async () => {
    const passwordHash = await hashPassword("correct-password");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A",
      passwordHash,
      createdAt: now,
      members: []
    } as never);

    await expect(
      authService.login({ email: "a@b.com", password: "wrong-password" })
    ).rejects.toThrow("Invalid email or password");
  });
});

describe("authService.refresh", () => {
  it("issues new tokens for a valid refresh token", async () => {
    const { refreshToken } = createAuthTokens({
      id: "user_1",
      email: "a@b.com"
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com"
    } as never);

    const result = await authService.refresh(refreshToken);
    expect(result.tokens.accessToken).toEqual(expect.any(String));
  });

  it("throws when the refresh token's user no longer exists", async () => {
    const { refreshToken } = createAuthTokens({
      id: "ghost",
      email: "ghost@b.com"
    });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(authService.refresh(refreshToken)).rejects.toThrow(
      "Invalid refresh token"
    );
  });
});
