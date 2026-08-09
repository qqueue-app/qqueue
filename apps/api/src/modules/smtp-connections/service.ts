import { SMTPProvider } from "@qqueue/email-engine";
import type {
  SMTPConnectionInput,
  SMTPConnectionUpdateInput
} from "@qqueue/shared";
import {
  SECRET_DECRYPTION_MESSAGE,
  SecretDecryptionError,
  decryptSecret,
  encryptSecret
} from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { assertOrgRole, getMembership } from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";
import { describeSmtpVerifyError } from "./verify-error.js";

export const smtpConnectionSelect = {
  id: true,
  organizationId: true,
  name: true,
  host: true,
  port: true,
  secure: true,
  fromEmail: true,
  fromName: true,
  replyTo: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true
};

/**
 * `""` clears a stored Reply-To, `undefined` leaves it alone. Prisma reads
 * `undefined` as "don't touch this column" and `null` as "set it to NULL", so
 * the two map straight through once the empty string is folded into null.
 */
export function normalizeReplyTo(replyTo: string | undefined) {
  if (replyTo === undefined) {
    return undefined;
  }
  return replyTo.trim() || null;
}

/**
 * Whether an update changes anything a live SMTP handshake could disprove.
 *
 * Renaming an account or pointing its Reply-To somewhere new says nothing about
 * the credentials, so re-verifying costs a round trip and — worse — makes an
 * edit fail for a reason unrelated to it: with the mail server down you could
 * not fix a typo in a Reply-To. "Test connection" exists for checking creds on
 * purpose.
 */
function assertSecretsReadable(connection: {
  usernameEncrypted: string;
  passwordEncrypted: string;
}) {
  try {
    decryptSecret(connection.usernameEncrypted);
    decryptSecret(connection.passwordEncrypted);
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      throw new HttpError(400, SECRET_DECRYPTION_MESSAGE);
    }
    throw error;
  }
}

function touchesTransport(input: SMTPConnectionUpdateInput) {
  return (
    input.host !== undefined ||
    input.port !== undefined ||
    input.secure !== undefined ||
    input.username !== undefined ||
    input.password !== undefined
  );
}

// Exported for Mailcow provisioning, which creates connections inside its own
// transaction — hence the injectable client.
export async function normalizeDefault(
  organizationId: string,
  isDefault: boolean | undefined,
  db: Pick<typeof prisma, "sMTPConnection"> = prisma
) {
  if (isDefault) {
    await db.sMTPConnection.updateMany({
      where: { organizationId },
      data: { isDefault: false }
    });
    return true;
  }

  const existingDefault = await db.sMTPConnection.findFirst({
    where: { organizationId, isDefault: true }
  });

  return !existingDefault;
}

function toProvider(
  connection: {
    host: string;
    port: number;
    secure: boolean;
    usernameEncrypted: string;
    passwordEncrypted: string;
  },
  timeouts?: { connectionTimeout: number; greetingTimeout: number }
) {
  return new SMTPProvider({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: {
      user: decryptSecret(connection.usernameEncrypted),
      pass: decryptSecret(connection.passwordEncrypted)
    },
    ...timeouts
  });
}

// Verification is interactive (the wizard and the connections dialog block on
// it), so fail well before Nodemailer's 2-minute connect / 30s greeting
// defaults. Sends keep the defaults.
const VERIFY_TIMEOUT_MS = 15_000;

// Exported for Mailcow provisioning's post-create probe, which uses a shorter
// timeout so its bounded retries can't stall the provisioning request.
export async function verifyConnection(
  connection: {
    host: string;
    port: number;
    secure: boolean;
    usernameEncrypted: string;
    passwordEncrypted: string;
  },
  timeoutMs: number = VERIFY_TIMEOUT_MS
) {
  try {
    await toProvider(connection, {
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs
    }).verify();
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      throw new HttpError(400, SECRET_DECRYPTION_MESSAGE);
    }

    throw new HttpError(400, describeSmtpVerifyError(error, connection));
  }
}

// Resolve a connection the user is allowed to touch, or throw 404. Returns the
// full record (including encrypted secrets) for internal use.
async function findOwned(id: string, userId: string) {
  const connection = await prisma.sMTPConnection.findFirst({
    where: { id, organization: { members: { some: { userId } } } }
  });
  if (!connection) {
    throw new HttpError(404, "SMTP connection not found");
  }
  return connection;
}

export const smtpConnectionService = {
  list(organizationId: string) {
    return prisma.sMTPConnection.findMany({
      where: { organizationId },
      select: smtpConnectionSelect,
      orderBy: { createdAt: "desc" }
    });
  },

  async get(id: string, userId: string) {
    await findOwned(id, userId);
    return prisma.sMTPConnection.findUnique({
      where: { id },
      select: smtpConnectionSelect
    });
  },

  async create(input: SMTPConnectionInput) {
    const usernameEncrypted = encryptSecret(input.username);
    const passwordEncrypted = encryptSecret(input.password);

    await verifyConnection({
      host: input.host,
      port: input.port,
      secure: input.secure,
      usernameEncrypted,
      passwordEncrypted
    });

    const isDefault = await normalizeDefault(
      input.organizationId,
      input.isDefault
    );

    return prisma.sMTPConnection.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        host: input.host,
        port: input.port,
        secure: input.secure,
        usernameEncrypted,
        passwordEncrypted,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        replyTo: normalizeReplyTo(input.replyTo) ?? null,
        isDefault
      },
      select: smtpConnectionSelect
    });
  },

  async update(id: string, userId: string, input: SMTPConnectionUpdateInput) {
    const existing = await findOwned(id, userId);
    // Writes are OWNER/ADMIN only (the route can't check: no org id in the
    // request until the row is loaded). Non-members still get the 404 above.
    await assertOrgRole(userId, existing.organizationId, ["OWNER", "ADMIN"]);
    // Connections stay in their original org; we never move them across tenants.
    const organizationId = existing.organizationId;
    const usernameEncrypted = input.username
      ? encryptSecret(input.username)
      : existing.usernameEncrypted;
    const passwordEncrypted = input.password
      ? encryptSecret(input.password)
      : existing.passwordEncrypted;

    if (touchesTransport(input)) {
      await verifyConnection({
        host: input.host ?? existing.host,
        port: input.port ?? existing.port,
        secure: input.secure ?? existing.secure,
        usernameEncrypted,
        passwordEncrypted
      });
    } else {
      // No handshake, but the stored secrets still have to be readable. An
      // unreadable one (a rotated ENCRYPTION_KEY, say) means this account can
      // no longer send at all, and quietly accepting a rename would bury that
      // behind a success toast. The check is local, so it costs nothing and
      // does not care whether the mail server is up.
      assertSecretsReadable({ usernameEncrypted, passwordEncrypted });
    }

    const isDefault =
      input.isDefault === undefined
        ? existing.isDefault
        : await normalizeDefault(organizationId, input.isDefault);

    return prisma.sMTPConnection.update({
      where: { id },
      data: {
        name: input.name,
        host: input.host,
        port: input.port,
        secure: input.secure,
        usernameEncrypted,
        passwordEncrypted,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        replyTo: normalizeReplyTo(input.replyTo),
        isDefault
      },
      select: smtpConnectionSelect
    });
  },

  async delete(id: string, userId: string) {
    const existing = await findOwned(id, userId);
    await assertOrgRole(userId, existing.organizationId, ["OWNER", "ADMIN"]);
    await prisma.sMTPConnection.delete({ where: { id } });
  },

  /**
   * On-demand connection test ("Test connection" in the UI). Membership-level
   * like other reads — it changes nothing and reveals only whether the stored
   * credentials work. Returns a result instead of throwing so the button can
   * show the provider's message without error-handling ceremony.
   */
  async verify(
    id: string,
    userId: string
  ): Promise<{ verified: boolean; message?: string }> {
    const connection = await findOwned(id, userId);
    try {
      await verifyConnection(connection);
      return { verified: true };
    } catch (error) {
      if (error instanceof HttpError) {
        return { verified: false, message: error.message };
      }
      throw error;
    }
  },

  /**
   * The connections this user may send as (Phase 4): every org connection for
   * OWNER/ADMIN, only granted ones for a MEMBER. Backs the composer's account
   * picker, so a member never sees an identity that would 403 at send time.
   */
  async listSendable(organizationId: string, userId: string) {
    const membership = await getMembership(userId, organizationId);
    if (!membership) {
      throw new HttpError(403, "You do not have access to this organization");
    }
    if (membership.role === "OWNER" || membership.role === "ADMIN") {
      return this.list(organizationId);
    }
    return prisma.sMTPConnection.findMany({
      where: { organizationId, grants: { some: { userId } } },
      select: smtpConnectionSelect,
      orderBy: { createdAt: "desc" }
    });
  },

  // Grant management is OWNER/ADMIN, like every other connection write.

  async listGrants(id: string, userId: string) {
    const connection = await findOwned(id, userId);
    await assertOrgRole(userId, connection.organizationId, ["OWNER", "ADMIN"]);
    return prisma.smtpConnectionGrant.findMany({
      where: { smtpConnectionId: id },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" }
    });
  },

  async addGrant(id: string, userId: string, granteeUserId: string) {
    const connection = await findOwned(id, userId);
    await assertOrgRole(userId, connection.organizationId, ["OWNER", "ADMIN"]);

    const granteeMembership = await getMembership(
      granteeUserId,
      connection.organizationId
    );
    if (!granteeMembership) {
      throw new HttpError(
        400,
        "That user is not a member of this organization",
        "validation_error"
      );
    }

    // Idempotent: re-granting is a no-op rather than an error.
    return prisma.smtpConnectionGrant.upsert({
      where: {
        smtpConnectionId_userId: {
          smtpConnectionId: id,
          userId: granteeUserId
        }
      },
      create: {
        organizationId: connection.organizationId,
        smtpConnectionId: id,
        userId: granteeUserId
      },
      update: {},
      include: { user: { select: { id: true, email: true, name: true } } }
    });
  },

  async removeGrant(id: string, userId: string, granteeUserId: string) {
    const connection = await findOwned(id, userId);
    await assertOrgRole(userId, connection.organizationId, ["OWNER", "ADMIN"]);
    await prisma.smtpConnectionGrant.deleteMany({
      where: { smtpConnectionId: id, userId: granteeUserId }
    });
  }
};
