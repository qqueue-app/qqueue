import { promises as dns } from "node:dns";
import { dkimDnsHost, dkimRecordMatches } from "@qqueue/shared";
import { prisma } from "./prisma.js";

// Resolve the DKIM TXT record for a managed domain and report whether the
// published public key matches the one QQueue generated. A missing record or a
// DNS error counts as "not verified" rather than throwing — propagation delay
// and NXDOMAIN are expected states, not failures of the job itself.
async function isDkimPublished(
  domain: string,
  selector: string,
  publicKeyPem: string
): Promise<boolean> {
  let records: string[][];
  try {
    records = await dns.resolveTxt(dkimDnsHost(selector, domain));
  } catch {
    return false;
  }

  // resolveTxt returns each record as an array of string chunks (long records
  // are split at 255 chars); rejoin before matching.
  return records.some((chunks) => dkimRecordMatches(chunks.join(""), publicKeyPem));
}

/**
 * Check one managed domain's DKIM DNS record and persist the result. External
 * domains and incomplete managed rows are skipped (nothing to verify).
 */
export async function verifySendingDomain(sendingDomainId: string): Promise<void> {
  const domain = await prisma.sendingDomain.findUnique({
    where: { id: sendingDomainId },
    select: {
      id: true,
      domain: true,
      dkimMode: true,
      dkimSelector: true,
      dkimPublicKey: true
    }
  });

  if (
    !domain ||
    domain.dkimMode !== "MANAGED" ||
    !domain.dkimSelector ||
    !domain.dkimPublicKey
  ) {
    return;
  }

  const verified = await isDkimPublished(
    domain.domain,
    domain.dkimSelector,
    domain.dkimPublicKey
  );
  const now = new Date();

  await prisma.sendingDomain.update({
    where: { id: domain.id },
    data: {
      dkimStatus: verified ? "VERIFIED" : "FAILED",
      lastCheckedAt: now,
      ...(verified ? { verifiedAt: now } : {})
    }
  });
}

/** Recheck every managed domain — used by the daily recheck scheduler. */
export async function verifyAllManagedDomains(): Promise<void> {
  const domains = await prisma.sendingDomain.findMany({
    where: { dkimMode: "MANAGED" },
    select: { id: true }
  });

  for (const domain of domains) {
    await verifySendingDomain(domain.id);
  }
}
