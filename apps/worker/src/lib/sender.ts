import type { DkimSignOptions } from "@qqueue/email-engine";
import type { DkimMode, DkimStatus } from "@qqueue/shared";
import { shouldSignManagedDkim } from "@qqueue/shared";
import { decryptSecret } from "./crypto.js";

/** RFC 5322 From header from a fromName/fromEmail pair. */
export function formatFrom(sender: {
  fromEmail: string;
  fromName: string | null;
}): string {
  return sender.fromName
    ? `${sender.fromName} <${sender.fromEmail}>`
    : sender.fromEmail;
}

type SendingDomainRow = {
  domain: string;
  dkimMode: DkimMode;
  dkimStatus: DkimStatus;
  dkimSelector: string | null;
  dkimPrivateKeyEncrypted: string | null;
};

/**
 * DKIM signing options for a job's sending domain, or undefined when QQueue
 * should not sign (external domains, unverified managed domains, or legacy jobs
 * with no sender identity). Mirrors the API's send-time decision.
 */
export function dkimSignOptionsFor(
  sendingDomain: SendingDomainRow | null | undefined
): DkimSignOptions | undefined {
  if (
    !sendingDomain ||
    !sendingDomain.dkimSelector ||
    !sendingDomain.dkimPrivateKeyEncrypted ||
    !shouldSignManagedDkim(sendingDomain.dkimMode, sendingDomain.dkimStatus)
  ) {
    return undefined;
  }
  return {
    domainName: sendingDomain.domain,
    keySelector: sendingDomain.dkimSelector,
    privateKey: decryptSecret(sendingDomain.dkimPrivateKeyEncrypted)
  };
}
