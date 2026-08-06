import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { env } from "../../config/env.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { createAuthTokens } from "../../lib/tokens.js";

// System mail rides the shared send pipeline; mock it at that seam.
const pipelineSend = vi
  .fn()
  .mockResolvedValue({ id: "job_reset", status: "QUEUED" });
vi.mock("../transactional-email/service.js", () => ({
  transactionalEmailService: { send: pipelineSend }
}));

const { authService } = await import("./service.js");
const { invalidateInstanceSettingsCache } = await import(
  "../../lib/instance-settings.js"
);

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
  pipelineSend.mockClear();
  invalidateInstanceSettingsCache();
});

describe("authService.register", () => {
  it("creates the user and org in a transaction and returns tokens", async () => {
    prismaMock.user.count.mockResolvedValue(0);
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
    prismaMock.user.count.mockResolvedValue(0);
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

  it("makes the first user instance admin and locks registration until setup", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.create.mockResolvedValue({
      id: "user_1",
      email: "first@b.com",
      name: null,
      createdAt: now
    } as never);
    prismaMock.organization.create.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);

    await authService.register({
      email: "first@b.com",
      password: "password123"
    });

    const createCall = prismaMock.user.create.mock.calls[0][0];
    expect(createCall.data.isInstanceAdmin).toBe(true);
    expect(prismaMock.instanceSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "allowPublicRegistration" },
        create: { key: "allowPublicRegistration", value: false }
      })
    );
  });

  it("rejects registration when users exist and the instance is closed", async () => {
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      { key: "allowPublicRegistration", value: false, updatedAt: now }
    ] as never);

    await expect(
      authService.register({ email: "b@b.com", password: "password123" })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("allows registration when users exist and the instance is open", async () => {
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.instanceSetting.findMany.mockResolvedValue([
      { key: "allowPublicRegistration", value: true, updatedAt: now }
    ] as never);
    prismaMock.user.create.mockResolvedValue({
      id: "user_2",
      email: "b@b.com",
      name: null,
      createdAt: now
    } as never);
    prismaMock.organization.create.mockResolvedValue({
      id: "org_2",
      name: "b@b.com's organization"
    } as never);

    const result = await authService.register({
      email: "b@b.com",
      password: "password123"
    });

    expect(result.user.id).toBe("user_2");
    const createCall = prismaMock.user.create.mock.calls[0][0];
    expect(createCall.data.isInstanceAdmin).toBe(false);
  });

  it("keeps registration open on existing installs with no settings rows", async () => {
    // Pre-onboarding databases have no InstanceSetting rows at all; the
    // absent-row default must stay "open" so upgrades change nothing.
    prismaMock.user.count.mockResolvedValue(5);
    prismaMock.instanceSetting.findMany.mockResolvedValue([] as never);
    prismaMock.user.create.mockResolvedValue({
      id: "user_6",
      email: "c@b.com",
      name: null,
      createdAt: now
    } as never);
    prismaMock.organization.create.mockResolvedValue({
      id: "org_6",
      name: "c@b.com's organization"
    } as never);

    await expect(
      authService.register({ email: "c@b.com", password: "password123" })
    ).resolves.toMatchObject({ user: { id: "user_6" } });
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
  // Phase 5: refresh needs both the signed JWT and a live server-side row.
  const liveRow = (overrides: Record<string, unknown> = {}) =>
    ({
      id: "rt_1",
      userId: "user_1",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      ...overrides
    }) as never;

  it("issues new tokens and rotates the stored row", async () => {
    const { refreshToken } = createAuthTokens({
      id: "user_1",
      email: "a@b.com"
    });
    prismaMock.refreshToken.findUnique.mockResolvedValue(liveRow());
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com"
    } as never);

    const result = await authService.refresh(refreshToken);

    expect(result.tokens.accessToken).toEqual(expect.any(String));
    // Rotation: the presented token's row is revoked and the new one stored.
    expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "rt_1" },
      data: { revokedAt: expect.any(Date) }
    });
    expect(prismaMock.refreshToken.create).toHaveBeenCalled();
  });

  it("rejects a refresh token with no server-side row (revoked or never issued)", async () => {
    const { refreshToken } = createAuthTokens({
      id: "user_1",
      email: "a@b.com"
    });
    prismaMock.refreshToken.findUnique.mockResolvedValue(null);

    await expect(authService.refresh(refreshToken)).rejects.toThrow(
      "Invalid refresh token"
    );
  });

  it("rejects a token revoked longer ago than the rotation grace window", async () => {
    const { refreshToken } = createAuthTokens({
      id: "user_1",
      email: "a@b.com"
    });
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      liveRow({ revokedAt: new Date(Date.now() - 5 * 60_000) })
    );

    await expect(authService.refresh(refreshToken)).rejects.toThrow(
      "Invalid refresh token"
    );
  });

  it("accepts a just-rotated token within the grace window (two tabs racing)", async () => {
    const { refreshToken } = createAuthTokens({
      id: "user_1",
      email: "a@b.com"
    });
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      liveRow({ revokedAt: new Date(Date.now() - 1_000) })
    );
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com"
    } as never);

    const result = await authService.refresh(refreshToken);

    expect(result.tokens.refreshToken).toEqual(expect.any(String));
    // Already revoked: no second revocation write.
    expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
  });

  it("rejects an expired server-side row even with a valid JWT", async () => {
    const { refreshToken } = createAuthTokens({
      id: "user_1",
      email: "a@b.com"
    });
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      liveRow({ expiresAt: new Date(Date.now() - 1_000) })
    );

    await expect(authService.refresh(refreshToken)).rejects.toThrow(
      "Invalid refresh token"
    );
  });

  it("throws when the refresh token's user no longer exists", async () => {
    const { refreshToken } = createAuthTokens({
      id: "ghost",
      email: "ghost@b.com"
    });
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      liveRow({ userId: "ghost" })
    );
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(authService.refresh(refreshToken)).rejects.toThrow(
      "Invalid refresh token"
    );
  });
});

describe("authService.logout", () => {
  it("revokes the presented token and stays silent about unknown ones", async () => {
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 } as never);
    await expect(authService.logout("some-token")).resolves.toMatchObject({
      message: expect.any(String)
    });
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });

    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 } as never);
    await expect(authService.logout("unknown")).resolves.toMatchObject({
      message: expect.any(String)
    });
  });
});

describe("authService.requestPasswordReset", () => {
  it("returns the generic message when the account does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await authService.requestPasswordReset("missing@b.com");

    expect(result.message).toContain("If an account exists");
    expect(result).not.toHaveProperty("resetToken");
    expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
    expect(pipelineSend).not.toHaveBeenCalled();
  });

  it("creates a reset token but does not echo it by default (Phase 3)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A"
    } as never);
    prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

    const result = await authService.requestPasswordReset("a@b.com");

    expect(result).not.toHaveProperty("resetToken");
    expect(prismaMock.passwordResetToken.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date)
      }
    });
  });

  it("echoes the reset token only with the explicit DEV_ECHO_RESET_TOKEN opt-in", async () => {
    env.DEV_ECHO_RESET_TOKEN = true;
    try {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "a@b.com",
        name: "A"
      } as never);
      prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
      prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

      const result = await authService.requestPasswordReset("a@b.com");

      expect(result.resetToken).toEqual(expect.any(String));
    } finally {
      env.DEV_ECHO_RESET_TOKEN = false;
    }
  });

  it("never returns the reset token in production, even when opted in", async () => {
    const originalEnv = env.NODE_ENV;
    env.NODE_ENV = "production";
    env.DEV_ECHO_RESET_TOKEN = true;
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
      env.DEV_ECHO_RESET_TOKEN = false;
    }
  });

  it("queues the reset email through the send pipeline as SYSTEM mail", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A"
    } as never);
    prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

    await authService.requestPasswordReset("a@b.com");

    expect(pipelineSend).toHaveBeenCalledOnce();
    const payload = pipelineSend.mock.calls[0][0];
    expect(payload.to).toBe("a@b.com");
    // Pinned to the exact connection found (which may not be the org default),
    // in the org that owns it.
    expect(payload.organizationId).toBe("org_1");
    expect(payload.smtpConnectionId).toBe("smtp_1");
    // SYSTEM origin: skips suppression checks and tracking injection so account
    // mail always goes out with its links untouched.
    expect(payload.origin).toBe("SYSTEM");
    expect(payload.createdByUserId).toBe("user_1");
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
    expect(pipelineSend).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still succeeds when queueing the reset email fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_1",
      email: "a@b.com",
      name: "A"
    } as never);
    prismaMock.passwordResetToken.create.mockResolvedValue({ id: "prt_1" } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);
    pipelineSend.mockRejectedValueOnce(new Error("queue down"));

    const result = await authService.requestPasswordReset("a@b.com");

    expect(result.message).toContain("If an account exists");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
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
    // Phase 5: a reset ends every existing session for the account.
    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_1" }
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
