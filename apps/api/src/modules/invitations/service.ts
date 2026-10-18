import { createHash, randomBytes } from "node:crypto";
import type { InviteAcceptInput, InviteCreateInput } from "@qqueue/shared";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword } from "../../lib/crypto.js";
import {
  assertOrgRole,
  getMembership,
  lockOrganizationTeam,
} from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";
import { createAuthTokens } from "../../lib/tokens.js";
import { persistRefreshToken } from "../../lib/refresh-tokens.js";
import { transactionalEmailService } from "../transactional-email/service.js";

// Invitations are valid for a week. Long enough to survive a weekend, short
// enough that a leaked link stops working before long.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Public fields for an invite — never includes `tokenHash`.
const inviteSelect = {
  id: true,
  organizationId: true,
  email: true,
  role: true,
  smtpConnectionIds: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
  invitedBy: { select: { id: true, email: true, name: true } },
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
 * connection (preferring its default). Routed through the shared send pipeline
 * as `origin: "SYSTEM"` — a queued EmailJob that skips suppression checks and
 * tracking injection. Best-effort: callers still get the acceptUrl back to
 * copy manually, so a missing connection or a queue failure never blocks
 * issuing the invite.
 */
async function sendInviteEmail(params: {
  organizationId: string;
  organizationName: string;
  email: string;
  acceptUrl: string;
  invitedByUserId: string;
}) {
  const connection = await prisma.sMTPConnection.findFirst({
    where: { organizationId: params.organizationId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (!connection) {
    console.warn(
      `[invitations] Skipping invite email to ${params.email}: organization ${params.organizationId} has no SMTP connection.`
    );
    return { queued: false };
  }

  const safeName = params.organizationName.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );
  await transactionalEmailService.send({
    organizationId: params.organizationId,
    smtpConnectionId: connection.id,
    to: params.email,
    subject: `You've been invited to join ${params.organizationName} on QQueue`,
    text: `Hi,\n\nYou've been invited to join "${params.organizationName}" on QQueue. Use the link below within the next 7 days to accept and set up your account:\n\n${params.acceptUrl}\n\nIf you weren't expecting this, you can safely ignore this email.`,
    html: `<p>Hi,</p><p>You've been invited to join <strong>${safeName}</strong> on QQueue. Use the link below within the next 7 days to accept and set up your account:</p><p><a href="${params.acceptUrl}">Accept your invitation</a></p><p>If you weren't expecting this, you can safely ignore this email.</p>`,
    origin: "SYSTEM",
    createdByUserId: params.invitedByUserId,
  });
  return { queued: true };
}

export const invitationService = {
  /**
   * Issue an invitation. OWNER/ADMIN only; minting a new OWNER requires the
   * inviter to be an OWNER. Supersedes any existing pending invite for the same
   * email so resends refresh the token and expiry instead of piling up.
   */
  async create(input: InviteCreateInput, invitedByUserId: string) {
    const membership = await assertOrgRole(
      invitedByUserId,
      input.organizationId,
      ["OWNER", "ADMIN"]
    );

    if (input.role !== "MEMBER" && membership.role !== "OWNER") {
      throw new HttpError(
        403,
        input.role === "OWNER"
          ? "Only an owner can invite another owner"
          : "Only an owner can invite an admin"
      );
    }

    const email = input.email.toLowerCase();

    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: input.organizationId,
        user: { email },
      },
    });
    if (existingMember) {
      throw new HttpError(
        409,
        "That person is already a member of this organization"
      );
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await lockOrganizationTeam(tx, input.organizationId);
        const currentActor = await assertOrgRole(
          invitedByUserId,
          input.organizationId,
          ["OWNER", "ADMIN"],
          tx
        );
        if (input.role !== "MEMBER" && currentActor.role !== "OWNER") {
          throw new HttpError(
            403,
            input.role === "OWNER"
              ? "Only an owner can invite another owner"
              : "Only an owner can invite an admin"
          );
        }
        const smtpConnectionIds = [...new Set(input.smtpConnectionIds ?? [])];
        await selectableMailboxes(
          tx,
          input.organizationId,
          invitedByUserId,
          currentActor.role,
          smtpConnectionIds
        );
        // Supersede any still-pending invite for this email/org.
        await tx.organizationInvite.updateMany({
          where: {
            organizationId: input.organizationId,
            email,
            status: "PENDING",
          },
          data: { status: "REVOKED" },
        });

        return tx.organizationInvite.create({
          data: {
            organizationId: input.organizationId,
            email,
            role: input.role,
            smtpConnectionIds,
            tokenHash,
            invitedByUserId,
            expiresAt,
          },
          select: inviteSelect,
        });
      }
    );

    const acceptUrl = buildAcceptUrl(token);
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true },
    });

    const delivery = await sendInviteEmail({
      organizationId: input.organizationId,
      organizationName: organization?.name ?? "an organization",
      email,
      acceptUrl,
      invitedByUserId,
    }).catch((error) => {
      console.error(
        `[invitations] Failed to send invite email to ${email}:`,
        error instanceof Error ? error.message : error
      );
      return { queued: false };
    });

    // The acceptUrl is returned only to the authenticated inviter, so exposing
    // it is safe and lets them share the link directly when email is unavailable.
    return { invite, acceptUrl, emailQueued: delivery.queued };
  },

  async list(organizationId: string, userId: string) {
    await assertOrgRole(userId, organizationId, ["OWNER", "ADMIN"]);
    return prisma.organizationInvite.findMany({
      where: { organizationId, status: "PENDING" },
      select: inviteSelect,
      orderBy: { createdAt: "desc" },
    });
  },

  async revoke(id: string, userId: string) {
    const existing = await prisma.organizationInvite.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true },
    });

    if (!existing) {
      throw new HttpError(404, "Invitation not found");
    }

    await assertOrgRole(userId, existing.organizationId, ["OWNER", "ADMIN"]);

    if (existing.status !== "PENDING") {
      throw new HttpError(400, "Only pending invitations can be revoked");
    }

    return prisma.organizationInvite
      .update({
        where: { id, status: "PENDING" },
        data: { status: "REVOKED" },
        select: inviteSelect,
      })
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2025"
        ) {
          throw new HttpError(400, "Only pending invitations can be revoked");
        }
        throw error;
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
        organization: { select: { name: true } },
      },
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
      select: { id: true },
    });

    return {
      email: invite.email,
      role: invite.role,
      organizationName: invite.organization.name,
      expiresAt: invite.expiresAt,
      // The accept page shows password fields only for brand-new accounts.
      hasAccount: Boolean(existingUser),
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
      where: { tokenHash: hashInviteToken(input.token) },
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
    });

    // Existing account: grant membership (if not already a member) and ask them
    // to sign in. Do not issue tokens for an account we haven't authenticated.
    if (existingUser) {
      const alreadyMember = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          await lockOrganizationTeam(tx, invite.organizationId);
          await consumeInvite(tx, invite.id);
          const member = await getMembership(
            existingUser.id,
            invite.organizationId,
            tx
          );
          if (!member) {
            const mailboxes = await acceptanceMailboxes(tx, invite);
            await tx.organizationMember.create({
              data: {
                organizationId: invite.organizationId,
                userId: existingUser.id,
                role: invite.role,
              },
            });
            await grantInviteMailboxes(
              tx,
              invite.organizationId,
              existingUser.id,
              mailboxes
            );
          }
          return Boolean(member);
        }
      );

      const organization = await prisma.organization.findUnique({
        where: { id: invite.organizationId },
        select: { id: true, name: true },
      });

      return {
        organization,
        requiresSignIn: true,
        alreadyMember: Boolean(alreadyMember),
      };
    }

    // New account: a password is required to create it.
    if (!input.password) {
      throw new HttpError(400, "A password is required to create your account");
    }

    const passwordHash = await hashPassword(input.password);

    const { user, organization } = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await lockOrganizationTeam(tx, invite.organizationId);
        await consumeInvite(tx, invite.id);
        const mailboxes = await acceptanceMailboxes(tx, invite);
        const createdUser = await tx.user.create({
          data: {
            email: invite.email,
            name: input.name,
            passwordHash,
          },
        });

        await tx.organizationMember.create({
          data: {
            organizationId: invite.organizationId,
            userId: createdUser.id,
            role: invite.role,
          },
        });

        await grantInviteMailboxes(
          tx,
          invite.organizationId,
          createdUser.id,
          mailboxes
        );
        const org = await tx.organization.findUnique({
          where: { id: invite.organizationId },
          select: { id: true, name: true },
        });

        return { user: createdUser, organization: org };
      }
    );

    const tokens = createAuthTokens(user);
    await persistRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
      },
      organization,
      role: invite.role,
      requiresSignIn: false,
      tokens,
    };
  },
};

async function consumeInvite(tx: Prisma.TransactionClient, id: string) {
  const now = new Date();
  const changed = await tx.organizationInvite.updateMany({
    where: { id, status: "PENDING", expiresAt: { gt: now } },
    data: { status: "ACCEPTED", acceptedAt: now },
  });
  if (changed.count !== 1)
    throw new HttpError(400, "This invitation is invalid or has expired");
}

type InviteMailbox = { id: string; fromEmail: string };

async function selectableMailboxes(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  role: string,
  ids: string[]
): Promise<InviteMailbox[]> {
  if (!ids.length) return [];
  const mailboxes = await tx.sMTPConnection.findMany({
    where: {
      organizationId,
      id: { in: ids },
      ...(role === "OWNER"
        ? {}
        : { grants: { none: { userId, revoked: true } } }),
    },
    select: { id: true, fromEmail: true },
  });
  if (mailboxes.length !== ids.length)
    throw new HttpError(
      403,
      "One or more assigned mailboxes are unavailable or you no longer have access. Ask an owner to renew the invitation.",
      "mailbox_access_denied"
    );
  return mailboxes;
}

async function acceptanceMailboxes(
  tx: Prisma.TransactionClient,
  invite: {
    organizationId: string;
    invitedByUserId: string;
    role: string;
    smtpConnectionIds: string[];
  }
) {
  const ids = [...new Set(invite.smtpConnectionIds ?? [])];
  if (!ids.length) return [];
  const actor = await getMembership(
    invite.invitedByUserId,
    invite.organizationId,
    tx
  );
  if (
    !actor ||
    (actor.role !== "OWNER" && actor.role !== "ADMIN") ||
    (invite.role !== "MEMBER" && actor.role !== "OWNER")
  ) {
    throw new HttpError(
      403,
      "The inviter can no longer assign these mailboxes. Ask an owner to renew the invitation.",
      "mailbox_access_denied"
    );
  }
  return selectableMailboxes(
    tx,
    invite.organizationId,
    invite.invitedByUserId,
    actor.role,
    ids
  );
}

async function grantInviteMailboxes(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  mailboxes: InviteMailbox[]
) {
  for (const mailbox of mailboxes) {
    await tx.smtpConnectionGrant.upsert({
      where: {
        smtpConnectionId_userId: { smtpConnectionId: mailbox.id, userId },
      },
      create: { organizationId, smtpConnectionId: mailbox.id, userId },
      update: { revoked: false },
    });
    const inbox = await tx.inboxAccount.findFirst({
      where: {
        organizationId,
        email: { equals: mailbox.fromEmail, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (inbox)
      await tx.inboxAccountGrant.upsert({
        where: { inboxAccountId_userId: { inboxAccountId: inbox.id, userId } },
        create: { organizationId, inboxAccountId: inbox.id, userId },
        update: { revoked: false },
      });
  }
}
