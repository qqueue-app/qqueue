import { HttpError } from "./http-error.js";
import { getMembership } from "./org-access.js";
import { prisma } from "./prisma.js";

/**
 * Send-as enforcement (Phase 4): OWNER/ADMIN may send from any org
 * connection; a MEMBER only from connections they hold a SmtpConnectionGrant
 * for.
 *
 * Enforced once, at creation time on every send surface (transactional +
 * manual sends, drafts, recurring sends, campaign start) — EmailJobs are
 * created after this check, so the worker deliberately does not re-verify.
 * Sends with no acting user (API-key sends, SYSTEM mail) pass `userId: null`:
 * an API key is an org-scoped credential and SYSTEM mail has no actor.
 */
export async function assertMayUseConnection(input: {
  userId: string | null | undefined;
  organizationId: string;
  /** Omit/null to mean the org's default connection. */
  smtpConnectionId?: string | null;
}): Promise<void> {
  if (!input.userId) {
    return;
  }

  const membership = await getMembership(input.userId, input.organizationId);
  if (!membership) {
    throw new HttpError(403, "You do not have access to this organization");
  }
  if (membership.role === "OWNER" || membership.role === "ADMIN") {
    return;
  }

  let smtpConnectionId = input.smtpConnectionId ?? null;
  if (!smtpConnectionId) {
    const defaultConnection = await prisma.sMTPConnection.findFirst({
      where: { organizationId: input.organizationId, isDefault: true },
      select: { id: true },
    });
    if (!defaultConnection) {
      // Nothing to guard — the send will fail with missing_smtp_connection
      // downstream, which is the clearer error.
      return;
    }
    smtpConnectionId = defaultConnection.id;
  }

  const grant = await prisma.smtpConnectionGrant.findUnique({
    where: {
      smtpConnectionId_userId: { smtpConnectionId, userId: input.userId },
    },
    select: { id: true },
  });
  if (!grant) {
    throw new HttpError(
      403,
      "You are not allowed to send as this account",
      "send_as_denied"
    );
  }
}
