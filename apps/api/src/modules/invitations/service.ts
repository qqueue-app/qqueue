import { createHash, randomBytes } from "node:crypto";
import type { InviteAcceptInput, InviteCreateInput } from "@qqueue/shared";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword } from "../../lib/crypto.js";
import { assertOrgRole, getMembership } from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";
import { createAuthTokens } from "../../lib/tokens.js";
import { smtpConnectionService } from "../smtp-connections/service.js";

// Invitations are valid for a week. Long enough to survive a weekend, short
// enough that a leaked link stops working before long.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Public fields for an invite — never includes `tokenHash`.
const inviteSelect = {
  id: true,
  organizationId: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
  invitedBy: { select: { id: true, email: true, name: true } }
} satisfies Prisma.OrganizationInviteSelect;

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildAcceptUrl(token: string) {
  const base = env.PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`;
}

/**
 * Deliver the invite link over email using the inviting organization's SMTP
 * connection (preferring its default). Best-effort: callers still get the
 * acceptUrl back to copy manually, so a missing connection or transient SMTP
 * failure never blocks issuing the invite.
 */
async function sendInviteEmail(params: {
  organizationId: string;
  organizationName: string;
  email: string;
  acceptUrl: string;
}) {
  const connection = await prisma.sMTPConnection.findFirst({
    where: { organizationId: params.organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
  });

  if (!connection) {
    console.warn(
      `[invitations] Skipping invite email to ${params.email}: organization ${params.organizationId} has no SMTP connection.`
    );
    return;
  }

  const provider = smtpConnectionService.getProviderForConnection(connection);

  await provider.send({
    from: connection.fromName
      ? `${connection.fromName} <${connection.fromEmail}>`
      : connection.fromEmail,
    to: params.email,
    subject: `You've been invited to join ${params.organizationName} on QQueue`,
    text: `Hi,\n\nYou've been invited to join "${params.organizationName}" on QQueue. Use the link below within the next 7 days to accept and set up your account:\n\n${params.acceptUrl}\n\nIf you weren't expecting this, you can safely ignore this email.`,
    html: `<p>Hi,</p><p>You've been invited to join <strong>${params.organizationName}</strong> on QQueue. Use the link below within the next 7 days to accept and set up your account:</p><p><a href="${params.acceptUrl}">Accept your invitation</a></p><p>If you weren't expecting this, you can safely ignore this email.</p>`
  });
}

export const invitationService = {
  /**
   * Issue an invitation. OWNER/ADMIN only; minting a new OWNER requires the
   * inviter to be an OWNER. Supersedes any existing pending invite for the same
   * email so resends refresh the token and expiry instead of piling up.
   */
  async create(input: InviteCreateInput, invitedByUserId: string) {
    const membership = await assertOrgRole(invitedByUserId, input.organizationId, [
      "OWNER",
      "ADMIN"
    ]);

    if (input.role === "OWNER" && membership.role !== "OWNER") {
      throw new HttpError(403, "Only an owner can invite another owner");
    }

    const email = input.email.toLowerCase();

    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: input.organizationId,
        user: { email }
      }
    });
    if (existingMember) {
      throw new HttpError(409, "That person is already a member of this organization");
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Supersede any still-pending invite for this email/org.
      await tx.organizationInvite.updateMany({
        where: {
          organizationId: input.organizationId,
          email,
          status: "PENDING"
        },
        data: { status: "REVOKED" }
      });

      return tx.organizationInvite.create({
        data: {
          organizationId: input.organizationId,
          email,
          role: input.role,
          tokenHash,
          invitedByUserId,
          expiresAt
        },
        select: inviteSelect
      });
    });

    const acceptUrl = buildAcceptUrl(token);
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true }
    });

    await sendInviteEmail({
      organizationId: input.organizationId,
      organizationName: organization?.name ?? "an organization",
      email,
      acceptUrl
    }).catch((error) => {
      console.error(
        `[invitations] Failed to send invite email to ${email}:`,
        error instanceof Error ? error.message : error
      );
    });

    // The acceptUrl is returned only to the authenticated inviter, so exposing
    // it is safe and lets them share the link directly when email is unavailable.
    return { invite, acceptUrl };
  },

  async list(organizationId: string, userId: string) {
    await assertOrgRole(userId, organizationId, ["OWNER", "ADMIN"]);
    return prisma.organizationInvite.findMany({
      where: { organizationId, status: "PENDING" },
      select: inviteSelect,
      orderBy: { createdAt: "desc" }
    });
  },

  async revoke(id: string, userId: string) {
    const existing = await prisma.organizationInvite.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true }
    });

    if (!existing) {
      throw new HttpError(404, "Invitation not found");
    }

    await assertOrgRole(userId, existing.organizationId, ["OWNER", "ADMIN"]);

    if (existing.status !== "PENDING") {
      throw new HttpError(400, "Only pending invitations can be revoked");
    }

    return prisma.organizationInvite.update({
      where: { id },
      data: { status: "REVOKED" },
      select: inviteSelect
    });
  },

  /**
   * Public preview of an invite from its token: enough for the accept page to
   * greet the invitee and decide whether to collect a password (only when no
   * account exists for the invited email yet).
   */
  async lookup(token: string) {
    const invite = await prisma.organizationInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      select: {
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        organization: { select: { name: true } }
      }
    });

    if (
      !invite ||
      invite.status !== "PENDING" ||
      invite.expiresAt.getTime() <= Date.now()
    ) {
      throw new HttpError(400, "This invitation is invalid or has expired");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
      select: { id: true }
    });

    return {
      email: invite.email,
      role: invite.role,
      organizationName: invite.organization.name,
      expiresAt: invite.expiresAt,
      // The accept page shows password fields only for brand-new accounts.
      hasAccount: Boolean(existingUser)
    };
  },

  /**
   * Accept an invite. For a brand-new email this creates the user + membership
   * and signs them straight in (the sanctioned exception to closed public
   * registration). For an email that already has an account, it grants
   * membership but asks them to sign in — we never mint tokens without a
   * verified password.
   */
  async accept(input: InviteAcceptInput) {
    const invite = await prisma.organizationInvite.findUnique({
      where: { tokenHash: hashInviteToken(input.token) }
    });

    if (
      !invite ||
      invite.status !== "PENDING" ||
      invite.expiresAt.getTime() <= Date.now()
    ) {
      throw new HttpError(400, "This invitation is invalid or has expired");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email }
    });

    // Existing account: grant membership (if not already a member) and ask them
    // to sign in. Do not issue tokens for an account we haven't authenticated.
    if (existingUser) {
      const alreadyMember = await getMembership(existingUser.id, invite.organizationId);

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (!alreadyMember) {
          await tx.organizationMember.create({
            data: {
              organizationId: invite.organizationId,
              userId: existingUser.id,
              role: invite.role
            }
          });
        }
        await tx.organizationInvite.update({
          where: { id: invite.id },
          data: { status: "ACCEPTED", acceptedAt: new Date() }
        });
      });

      const organization = await prisma.organization.findUnique({
        where: { id: invite.organizationId },
        select: { id: true, name: true }
      });

      return {
        organization,
        requiresSignIn: true,
        alreadyMember: Boolean(alreadyMember)
      };
    }

    // New account: a password is required to create it.
    if (!input.password) {
      throw new HttpError(400, "A password is required to create your account");
    }

    const passwordHash = await hashPassword(input.password);

    const { user, organization } = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const createdUser = await tx.user.create({
          data: {
            email: invite.email,
            name: input.name,
            passwordHash
          }
        });

        await tx.organizationMember.create({
          data: {
            organizationId: invite.organizationId,
            userId: createdUser.id,
            role: invite.role
          }
        });

        await tx.organizationInvite.update({
          where: { id: invite.id },
          data: { status: "ACCEPTED", acceptedAt: new Date() }
        });

        const org = await tx.organization.findUnique({
          where: { id: invite.organizationId },
          select: { id: true, name: true }
        });

        return { user: createdUser, organization: org };
      }
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString()
      },
      organization,
      role: invite.role,
      requiresSignIn: false,
      tokens: createAuthTokens(user)
    };
  }
};
