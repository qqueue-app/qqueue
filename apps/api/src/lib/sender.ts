import type { DkimMode, DkimStatus } from "@qqueue/shared";
import type { DkimSignOptions } from "@qqueue/email-engine";
import { shouldSignManagedDkim } from "@qqueue/shared";
import { decryptSecret } from "./crypto.js";
import { HttpError } from "./http-error.js";
import { prisma } from "./prisma.js";

// Encrypted secrets are included because the inline transactional send builds an
// SMTP provider and (for managed domains) signs DKIM in-process.
const smtpSelect = {
  id: true,
  host: true,
  port: true,
  secure: true,
  usernameEncrypted: true,
  passwordEncrypted: true,
  fromEmail: true,
  fromName: true
};

const sendingDomainSelect = {
  domain: true,
  dkimMode: true,
  dkimStatus: true,
  dkimSelector: true,
  dkimPrivateKeyEncrypted: true
};

const identityInclude = {
  smtpConnection: { select: smtpSelect },
  sendingDomain: { select: sendingDomainSelect }
};

type SmtpRow = {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  usernameEncrypted: string;
  passwordEncrypted: string;
  fromEmail: string;
  fromName: string | null;
};

type SendingDomainRow = {
  domain: string;
  dkimMode: DkimMode;
  dkimStatus: DkimStatus;
  dkimSelector: string | null;
  dkimPrivateKeyEncrypted: string | null;
};

export interface ResolvedSender {
  // The chosen sender identity, or null for a legacy SMTP-connection send.
  senderIdentityId: string | null;
  // The SMTP credential used to transport the message.
  smtpConnection: SmtpRow;
  // The visible From — from the identity when present, else the SMTP connection.
  fromEmail: string;
  fromName: string | null;
  // The identity's default reply-to, if any (callers override with their own).
  replyTo: string | null;
  // The identity's sending domain, used to decide DKIM signing. Null for legacy.
  sendingDomain: SendingDomainRow | null;
}

function fromIdentity(identity: {
  id: string;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  smtpConnection: SmtpRow;
  sendingDomain: SendingDomainRow;
}): ResolvedSender {
  return {
    senderIdentityId: identity.id,
    smtpConnection: identity.smtpConnection,
    fromEmail: identity.fromEmail,
    fromName: identity.fromName,
    replyTo: identity.replyTo,
    sendingDomain: identity.sendingDomain
  };
}

function fromSmtp(smtp: SmtpRow): ResolvedSender {
  return {
    senderIdentityId: null,
    smtpConnection: smtp,
    fromEmail: smtp.fromEmail,
    fromName: smtp.fromName,
    replyTo: null,
    sendingDomain: null
  };
}

/**
 * Resolve who a message sends as. Precedence:
 *   1. An explicit sender identity (the new first-class path used by every UI
 *      surface).
 *   2. An explicit SMTP connection (legacy / public transactional API + SDK).
 *   3. The org's default sender identity.
 *   4. The org's default SMTP connection (legacy orgs with no identities yet).
 * Throws a clear 404 when a referenced identity/connection isn't found, or when
 * the org has nothing configured to send from.
 */
export async function resolveSender(
  organizationId: string,
  opts: { senderIdentityId?: string | null; smtpConnectionId?: string | null }
): Promise<ResolvedSender> {
  if (opts.senderIdentityId) {
    const identity = await prisma.senderIdentity.findFirst({
      where: { id: opts.senderIdentityId, organizationId },
      include: identityInclude
    });
    if (!identity) {
      throw new HttpError(
        404,
        "Sender identity not found",
        "missing_smtp_connection"
      );
    }
    return fromIdentity(identity);
  }

  if (opts.smtpConnectionId) {
    const smtp = await prisma.sMTPConnection.findFirst({
      where: { id: opts.smtpConnectionId, organizationId },
      select: smtpSelect
    });
    if (!smtp) {
      throw new HttpError(
        404,
        "SMTP connection not found",
        "missing_smtp_connection"
      );
    }
    return fromSmtp(smtp);
  }

  const defaultIdentity = await prisma.senderIdentity.findFirst({
    where: { organizationId, isDefault: true },
    include: identityInclude
  });
  if (defaultIdentity) {
    return fromIdentity(defaultIdentity);
  }

  const defaultSmtp = await prisma.sMTPConnection.findFirst({
    where: { organizationId, isDefault: true },
    select: smtpSelect
  });
  if (defaultSmtp) {
    return fromSmtp(defaultSmtp);
  }

  throw new HttpError(
    404,
    "No sender identity or SMTP connection configured",
    "missing_smtp_connection"
  );
}

/**
 * The DKIM signing options for a resolved sender, or undefined when QQueue
 * should not sign (external domains, unverified managed domains, legacy sends).
 * The single send-time decision, shared by both API send sites.
 */
export function dkimSignOptionsFor(
  sender: ResolvedSender
): DkimSignOptions | undefined {
  const domain = sender.sendingDomain;
  if (
    !domain ||
    !domain.dkimSelector ||
    !domain.dkimPrivateKeyEncrypted ||
    !shouldSignManagedDkim(domain.dkimMode, domain.dkimStatus)
  ) {
    return undefined;
  }
  return {
    domainName: domain.domain,
    keySelector: domain.dkimSelector,
    privateKey: decryptSecret(domain.dkimPrivateKeyEncrypted)
  };
}

/** Format an RFC 5322 From header from a resolved sender. */
export function formatSenderFrom(sender: {
  fromEmail: string;
  fromName: string | null;
}): string {
  return sender.fromName
    ? `${sender.fromName} <${sender.fromEmail}>`
    : sender.fromEmail;
}
