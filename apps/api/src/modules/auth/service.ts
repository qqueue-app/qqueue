import type { LoginInput, RegisterInput } from "@qqueue/shared";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import {
  getInstanceSettings,
  setInstanceSettings
} from "../../lib/instance-settings.js";
import { prisma } from "../../lib/prisma.js";
import { createAuthTokens, verifyRefreshToken } from "../../lib/tokens.js";
import {
  ROTATION_GRACE_MS,
  hashRefreshToken,
  persistRefreshToken,
  pruneRefreshTokens
} from "../../lib/refresh-tokens.js";
import { transactionalEmailService } from "../transactional-email/service.js";

function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString()
  };
}

type UserOrganizationMember = {
  organization: {
    id: string;
    name: string;
  };
  role: string;
};

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildResetUrl(token: string) {
  const base = env.PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Deliver a password reset link over email. Reuses the requesting user's
 * organization SMTP connection (preferring the default) so production never
 * has to expose the raw token in the API response. Routed through the shared
 * send pipeline as `origin: "SYSTEM"`: the message becomes a queued EmailJob
 * like every other send, but skips suppression checks and tracking injection
 * (account mail must reach unsubscribed users, with its links untouched).
 * Best-effort: callers wrap this so a missing connection or a queue failure
 * does not leak whether an account exists or break the request flow.
 */
async function sendPasswordResetEmail(
  user: { id: string; email: string; name: string | null },
  token: string
) {
  const connection = await prisma.sMTPConnection.findFirst({
    where: { organization: { members: { some: { userId: user.id } } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
  });

  if (!connection) {
    console.warn(
      `[auth] Skipping password reset email for ${user.email}: no SMTP connection is configured.`
    );
    return;
  }

  const resetUrl = buildResetUrl(token);
  const greeting = user.name ? `Hi ${user.name},` : "Hi,";

  await transactionalEmailService.send({
    organizationId: connection.organizationId,
    smtpConnectionId: connection.id,
    to: user.email,
    subject: "Reset your QQueue password",
    text: `${greeting}\n\nWe received a request to reset your QQueue password. Use the link below within the next hour to choose a new password:\n\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `<p>${greeting}</p><p>We received a request to reset your QQueue password. Use the link below within the next hour to choose a new password:</p><p><a href="${resetUrl}">Reset your password</a></p><p>If you did not request this, you can safely ignore this email.</p>`,
    origin: "SYSTEM",
    createdByUserId: user.id
  });
}

export const authService = {
  async register(input: RegisterInput) {
    const passwordHash = await hashPassword(input.password);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Bootstrap exception: a fresh install (zero users) can always register
      // its first user, who becomes the instance admin. After that, an
      // instance admin must have left public registration open.
      const isFirstUser = (await tx.user.count()) === 0;
      if (!isFirstUser) {
        const settings = await getInstanceSettings();
        if (!settings.allowPublicRegistration) {
          throw new HttpError(
            403,
            "Registration is closed on this instance. Ask an administrator for an account."
          );
        }
      }

      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          isInstanceAdmin: isFirstUser
        }
      });

      const organization = await tx.organization.create({
        data: {
          name: input.organizationName ?? `${input.email}'s organization`,
          members: {
            create: {
              userId: user.id,
              role: "OWNER"
            }
          }
        }
      });

      if (isFirstUser) {
        // Lock registration until the setup wizard records the admin's
        // explicit choice, so strangers can't register mid-setup.
        await setInstanceSettings({ allowPublicRegistration: false }, tx);
      }

      return { user, organization };
    });

    const tokens = createAuthTokens(result.user);
    await persistRefreshToken(result.user.id, tokens.refreshToken);

    return {
      user: serializeUser(result.user),
      organization: result.organization,
      tokens
    };
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: {
        members: {
          include: {
            organization: true
          }
        }
      }
    });

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password");
    }

    const tokens = createAuthTokens(user);
    await persistRefreshToken(user.id, tokens.refreshToken);
    // Opportunistic cleanup so the table doesn't grow without a cron.
    await pruneRefreshTokens(user.id);

    return {
      user: serializeUser(user),
      organizations: user.members.map((member: UserOrganizationMember) => ({
        id: member.organization.id,
        name: member.organization.name,
        role: member.role
      })),
      tokens
    };
  },

  /**
   * Refresh requires the signed JWT *and* a live server-side row (Phase 5):
   * a leaked token dies with logout/password-reset instead of surviving its
   * full 30 days. Each use rotates the row; a just-rotated token keeps
   * working within a short grace window so two tabs racing a refresh don't
   * log the loser out.
   */
  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) }
    });
    const now = Date.now();
    const usable =
      stored &&
      stored.userId === payload.sub &&
      stored.expiresAt.getTime() > now &&
      (!stored.revokedAt ||
        now - stored.revokedAt.getTime() <= ROTATION_GRACE_MS);
    if (!usable) {
      throw new HttpError(401, "Invalid refresh token");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (!user) {
      throw new HttpError(401, "Invalid refresh token");
    }

    const tokens = createAuthTokens(user);
    if (!stored.revokedAt) {
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() }
      });
    }
    await persistRefreshToken(user.id, tokens.refreshToken);

    return { tokens };
  },

  /**
   * Server-side logout: revoke the presented refresh token. Deliberately
   * silent about whether the token existed — logout must be idempotent and
   * reveal nothing.
   */
  async logout(refreshToken: string) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() }
    });
    return { message: "Signed out." };
  },

  async requestPasswordReset(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return {
        message:
          "If an account exists for that email, a password reset link has been prepared."
      };
    }

    const token = randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS)
      }
    });

    // Best-effort delivery: never surface SMTP/account-existence details to the
    // caller. Failures are logged server-side and swallowed here.
    await sendPasswordResetEmail(user, token).catch((error) => {
      console.error(
        `[auth] Failed to send password reset email for ${user.email}:`,
        error instanceof Error ? error.message : error
      );
    });

    return {
      message:
        "If an account exists for that email, a password reset link has been prepared.",
      // Outside production we echo the token so local/dev flows work without a
      // configured mailbox. Production relies solely on the emailed link.
      // Echoing the token is an explicit dev-only opt-in (double-guarded:
      // never in production). The old `NODE_ENV !== "production"` condition
      // meant a prod instance that forgot to set NODE_ENV handed account
      // takeover to anyone who could type an email address.
      ...(env.DEV_ECHO_RESET_TOKEN && env.NODE_ENV !== "production"
        ? { resetToken: token }
        : {})
    };
  },

  async resetPassword(token: string, password: string) {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) }
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() <= Date.now()
    ) {
      throw new HttpError(400, "Password reset token is invalid or expired");
    }

    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash }
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() }
      }),
      // Whoever held the old password may hold refresh tokens too — a reset
      // must end every existing session (Phase 5).
      prisma.refreshToken.deleteMany({
        where: { userId: resetToken.userId }
      })
    ]);

    return { message: "Password has been reset." };
  }
};
