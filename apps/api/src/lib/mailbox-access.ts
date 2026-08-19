import type { Prisma } from "@prisma/client";
import { HttpError } from "./http-error.js";
import { getMembership } from "./org-access.js";
import { prisma } from "./prisma.js";

/**
 * Per-mailbox access: which mailboxes a person may read, and send as.
 *
 * OWNER/ADMIN see everything in their organization. A MEMBER sees only the
 * mailboxes an owner or admin has assigned to them — in the inbox, in the sent
 * archive, and in the outbox. This is the read-side companion to send-as
 * enforcement in lib/send-as.ts, which stays the authority on sending.
 *
 * The product presents one toggle per person per mailbox meaning "read and send
 * as this". Underneath there are two tables, because a mailbox is two
 * independent rows with no foreign key joining them: an InboxAccount (IMAP,
 * receive) and an SMTPConnection (send). Either can exist without the other, so
 * both are grantable and the pairing is done by address, here.
 */

/** OWNER and ADMIN are never restricted; only a MEMBER is. */
export interface MailboxAccess {
  userId: string;
  organizationId: string;
  /** True for OWNER/ADMIN: every mailbox in the org, no row required. */
  unrestricted: boolean;
  /** Readable mailboxes. Meaningless when `unrestricted`. */
  inboxAccountIds: string[];
  /** Sendable connections. Meaningless when `unrestricted`. */
  smtpConnectionIds: string[];
}

/**
 * Resolve what one person may reach in one organization. Two indexed queries,
 * so callers should resolve once per request and reuse the result rather than
 * asking per row.
 */
export async function resolveMailboxAccess(
  userId: string,
  organizationId: string
): Promise<MailboxAccess> {
  const membership = await getMembership(userId, organizationId);
  if (!membership) {
    throw new HttpError(403, "You do not have access to this organization");
  }

  if (membership.role === "OWNER" || membership.role === "ADMIN") {
    return {
      userId,
      organizationId,
      unrestricted: true,
      inboxAccountIds: [],
      smtpConnectionIds: [],
    };
  }

  const [inboxGrants, smtpGrants] = await Promise.all([
    prisma.inboxAccountGrant.findMany({
      where: { organizationId, userId },
      select: { inboxAccountId: true },
    }),
    prisma.smtpConnectionGrant.findMany({
      where: { organizationId, userId },
      select: { smtpConnectionId: true },
    }),
  ]);

  return {
    userId,
    organizationId,
    unrestricted: false,
    inboxAccountIds: inboxGrants.map((grant) => grant.inboxAccountId),
    smtpConnectionIds: smtpGrants.map((grant) => grant.smtpConnectionId),
  };
}

/**
 * Received mail the holder may read. An empty grant list yields
 * `{ in: [] }`, which matches nothing — a member with no mailboxes assigned
 * gets an empty inbox rather than the whole organization's.
 */
export function inboundMessageScope(
  access: MailboxAccess
): Prisma.InboundMessageWhereInput {
  if (access.unrestricted) return {};
  return { inboxAccountId: { in: access.inboxAccountIds } };
}

/**
 * Sent and queued mail the holder may see: anything sent as a mailbox they hold,
 * plus anything they sent themselves.
 *
 * The second half matters because access can be revoked, and a mailbox can be
 * deleted out from under a job (EmailJob.smtpConnectionId is `SetNull` on
 * delete). Without it, someone's own outgoing mail would vanish from their sent
 * list the moment either happened, which reads as data loss. It leaks nothing:
 * they composed it.
 */
export function emailJobScope(
  access: MailboxAccess
): Prisma.EmailJobWhereInput {
  if (access.unrestricted) return {};
  return {
    OR: [
      { smtpConnectionId: { in: access.smtpConnectionIds } },
      { createdByUserId: access.userId },
    ],
  };
}

/** Throw unless this person may read this specific mailbox. */
export function assertInboxAccountAccess(
  access: MailboxAccess,
  inboxAccountId: string
): void {
  if (access.unrestricted) return;
  if (access.inboxAccountIds.includes(inboxAccountId)) return;
  throw new HttpError(
    403,
    "You do not have access to this mailbox",
    "mailbox_access_denied"
  );
}

/**
 * Whether this person may send as one specific connection, without throwing.
 *
 * The read-side twin of assertMayUseConnection: same rule, phrased as a
 * question, for the places that filter a list rather than refuse a request.
 * `null` means the organization's default — and when there is no default there
 * is nothing to guard, so it answers yes and lets the send fail later with the
 * clearer missing_smtp_connection.
 */
export async function mayUseConnection(
  access: MailboxAccess,
  smtpConnectionId: string | null
): Promise<boolean> {
  if (access.unrestricted) return true;

  let connectionId = smtpConnectionId;
  if (!connectionId) {
    const defaultConnection = await prisma.sMTPConnection.findFirst({
      where: { organizationId: access.organizationId, isDefault: true },
      select: { id: true },
    });
    if (!defaultConnection) return true;
    connectionId = defaultConnection.id;
  }

  return access.smtpConnectionIds.includes(connectionId);
}

/**
 * Which campaigns are this person's to see.
 *
 * A campaign has no mailbox of its own beyond the account it sends as, so
 * "may they see it" has the same answer as "may they start it" — anyone who
 * could never send a campaign has no reason to read its audience, copy and
 * results. A campaign that names no account sends as the org default, so it is
 * visible to whoever holds the default.
 *
 * Returned as a where clause rather than a per-row check because the campaign
 * list would otherwise resolve the same two facts once per row.
 */
export async function campaignScope(
  access: MailboxAccess
): Promise<Prisma.CampaignWhereInput> {
  if (access.unrestricted) return {};

  const clauses: Prisma.CampaignWhereInput[] = [
    { smtpConnectionId: { in: access.smtpConnectionIds } },
  ];
  if (await mayUseConnection(access, null)) {
    clauses.push({ smtpConnectionId: null });
  }

  // With no grants and no claim on the default this is `{ in: [] }` alone,
  // which matches nothing — an empty campaign list rather than everyone's.
  return { OR: clauses };
}

/**
 * The InboxAccount that answers to the same address as a connection, if the
 * organization has one.
 *
 * Addresses are compared case-insensitively: SMTPConnection.fromEmail is stored
 * as typed, while a mailbox provisioned through Mailcow is normalised, so an
 * exact match would silently fail to pair the two halves of one mailbox and
 * grant only send.
 */
export async function findPairedInboxAccountId(
  organizationId: string,
  fromEmail: string
): Promise<string | null> {
  const account = await prisma.inboxAccount.findFirst({
    where: {
      organizationId,
      email: { equals: fromEmail, mode: "insensitive" },
    },
    select: { id: true },
  });
  return account?.id ?? null;
}
