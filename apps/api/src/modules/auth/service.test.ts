import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { env } from "../../config/env.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { createAuthTokens } from "../../lib/tokens.js";

const providerSend = vi
  .fn()
  .mockResolvedValue({ messageId: "m", accepted: [], rejected: [], provider: "smtp" });
vi.mock("../smtp-connections/service.js", () => ({
  smtpConnectionService: {
    getProviderForConnection: vi.fn(() => ({ send: providerSend }))
  }
}));

const { authService } = await import("./service.js");

const now = new Date("2026-01-01T00:00:00.000Z");

const smtpConnection = {
  id: "smtp_1",
  organizationId: "org_1",
  host: "smtp.example.com",
  port: 587,
  secure: false,
  usernameEncrypted: "u",
  passwordEncrypted: "p",
  fromEmail: "no-reply@example.com",
  fromName: "QQueue",
  isDefault: true
};

beforeEach(() => {
  providerSend.mockClear();
});

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

describe("authService.requestPasswordReset", () => {
  it("returns the generic message when the account does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await authService.requestPasswordReset("missing@b.com");

    expect(result.message).toContain("If an account exists");
    expect(result).not.toHaveProperty("resetToken");
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
    expect(providerSend).not.toHaveBeenCalled();
  });

  it("creates a reset token for an existing user in non-production", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A"
    } as never);
    prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

    const result = await authService.requestPasswordReset("a@b.com");

    expect(result.resetToken).toEqual(expect.any(String));
    expect(prismaMock.passwordResetToken.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date)
      }
    });
  });

  it("does not return the reset token in production", async () => {
    const originalEnv = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "a@b.com",
        name: "A"
      } as never);
      prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
      prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

      const result = await authService.requestPasswordReset("a@b.com");

      expect(result).not.toHaveProperty("resetToken");
      expect(result.message).toContain("If an account exists");
    } finally {
      env.NODE_ENV = originalEnv;
    }
  });

  it("emails the reset link via the org SMTP connection", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A"
    } as never);
    prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

    await authService.requestPasswordReset("a@b.com");

    expect(providerSend).toHaveBeenCalledOnce();
    const payload = providerSend.mock.calls[0][0];
    expect(payload.to).toBe("a@b.com");
    expect(payload.from).toBe("QQueue <no-reply@example.com>");
    expect(payload.html).toContain("/reset-password?token=");
    expect(payload.text).toContain("/reset-password?token=");
  });

  it("still succeeds when no SMTP connection is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A"
    } as never);
    prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);

    const result = await authService.requestPasswordReset("a@b.com");

    expect(result.message).toContain("If an account exists");
    expect(providerSend).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("authService.resetPassword", () => {
  it("updates the password and marks the token used", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt_1",
      userId: "user_1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null
    } as never);
    prismaMock.user.update.mockResolvedValue({ id: "user_1" } as never);
    prismaMock.passwordResetToken.update.mockResolvedValue({ id: "prt_1" } as never);

    await authService.resetPassword("token_value_12345678901234567890", "new-password");

    const updateCall = prismaMock.user.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: "user_1" });
    expect(await verifyPassword("new-password", updateCall.data.passwordHash as string)).toBe(
      true
    );
    expect(prismaMock.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: "prt_1" },
      data: { usedAt: expect.any(Date) }
    });
  });

  it("rejects expired reset tokens", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt_1",
      userId: "user_1",
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null
    } as never);

    await expect(
      authService.resetPassword("token_value_12345678901234567890", "new-password")
    ).rejects.toThrow("Password reset token is invalid or expired");
  });

  it("rejects unknown/invalid reset tokens", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(
      authService.resetPassword("does-not-exist", "new-password")
    ).rejects.toThrow("Password reset token is invalid or expired");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects an already-used token, proving a successful reset invalidates it", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt_1",
      userId: "user_1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(Date.now() - 1_000)
    } as never);

    await expect(
      authService.resetPassword("token_value_12345678901234567890", "new-password")
    ).rejects.toThrow("Password reset token is invalid or expired");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
