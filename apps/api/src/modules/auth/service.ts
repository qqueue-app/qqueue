import type { LoginInput, RegisterInput } from "@qqueue/shared";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { createAuthTokens, verifyRefreshToken } from "../../lib/tokens.js";
import { smtpConnectionService } from "../smtp-connections/service.js";

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
 * has to expose the raw token in the API response. Best-effort: callers wrap
 * this so a missing connection or transient SMTP failure does not leak whether
 * an account exists or break the request flow.
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
  const provider = smtpConnectionService.getProviderForConnection(connection);

  await provider.send({
    from: connection.fromName
      ? `${connection.fromName} <${connection.fromEmail}>`
      : connection.fromEmail,
    to: user.email,
    subject: "Reset your QQueue password",
    text: `${greeting}\n\nWe received a request to reset your QQueue password. Use the link below within the next hour to choose a new password:\n\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `<p>${greeting}</p><p>We received a request to reset your QQueue password. Use the link below within the next hour to choose a new password:</p><p><a href="${resetUrl}">Reset your password</a></p><p>If you did not request this, you can safely ignore this email.</p>`
  });
}

export const authService = {
  async register(input: RegisterInput) {
    const passwordHash = await hashPassword(input.password);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash
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

      return { user, organization };
    });

    return {
      user: serializeUser(result.user),
      organization: result.organization,
      tokens: createAuthTokens(result.user)
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

    return {
      user: serializeUser(user),
      organizations: user.members.map((member: UserOrganizationMember) => ({
        id: member.organization.id,
        name: member.organization.name,
        role: member.role
      })),
      tokens: createAuthTokens(user)
    };
  },

  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (!user) {
      throw new HttpError(401, "Invalid refresh token");
    }

    return { tokens: createAuthTokens(user) };
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
      ...(env.NODE_ENV === "production" ? {} : { resetToken: token })
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
      })
    ]);

    return { message: "Password has been reset." };
  }
};
