import {
  buildSendingDomainDnsRecords,
  type SendingDomainInput,
  type SendingDomainUpdateInput
} from "@qqueue/shared";
import { encryptSecret } from "../../lib/crypto.js";
import { generateManagedDkim } from "../../lib/dkim.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { dkimVerificationQueue } from "../../queues/dkim-verification.queue.js";

// Public shape: never expose the encrypted private key to clients. The selector
// and public key are returned so the API can compute DNS instructions.
const sendingDomainSelect = {
  id: true,
  organizationId: true,
  domain: true,
  dkimMode: true,
  dkimSelector: true,
  dkimPublicKey: true,
  dkimStatus: true,
  spfNote: true,
  verifiedAt: true,
  lastCheckedAt: true,
  createdAt: true,
  updatedAt: true
};

type SendingDomainRow = {
  dkimMode: string;
  dkimSelector: string | null;
  dkimPublicKey: string | null;
  domain: string;
};

// Attach copy-paste DNS records for managed-mode domains; external domains have
// nothing for the operator to publish, so dnsRecords is null.
function withDnsRecords<T extends SendingDomainRow>(domain: T) {
  if (
    domain.dkimMode === "MANAGED" &&
    domain.dkimSelector &&
    domain.dkimPublicKey
  ) {
    return {
      ...domain,
      dnsRecords: buildSendingDomainDnsRecords(
        domain.dkimSelector,
        domain.domain,
        domain.dkimPublicKey
      )
    };
  }
  return { ...domain, dnsRecords: null };
}

// Resolve a sending domain the caller is allowed to touch, or throw 404. Routes
// addressed by id rely on this membership scoping rather than requireOrgMembership.
async function findOwned(id: string, userId: string) {
  const domain = await prisma.sendingDomain.findFirst({
    where: { id, organization: { members: { some: { userId } } } }
  });
  if (!domain) {
    throw new HttpError(404, "Sending domain not found");
  }
  return domain;
}

export const sendingDomainService = {
  async list(organizationId: string) {
    const domains = await prisma.sendingDomain.findMany({
      where: { organizationId },
      select: sendingDomainSelect,
      orderBy: { createdAt: "desc" }
    });
    return domains.map(withDnsRecords);
  },

  async get(id: string, userId: string) {
    await findOwned(id, userId);
    const domain = await prisma.sendingDomain.findUnique({
      where: { id },
      select: sendingDomainSelect
    });
    return domain ? withDnsRecords(domain) : null;
  },

  async create(input: SendingDomainInput) {
    const base = {
      organizationId: input.organizationId,
      domain: input.domain,
      spfNote: input.spfNote ?? null
    };

    // MANAGED mode: QQueue owns signing, so generate the keypair now, store the
    // private key encrypted (same scheme as SMTP secrets), and start PENDING
    // until DNS verification confirms the public key is published. EXTERNAL mode
    // trusts the upstream server/relay, so there is nothing to verify (NA).
    const data =
      input.dkimMode === "MANAGED"
        ? (() => {
            const keypair = generateManagedDkim();
            return {
              ...base,
              dkimMode: "MANAGED" as const,
              dkimSelector: keypair.selector,
              dkimPrivateKeyEncrypted: encryptSecret(keypair.privateKey),
              dkimPublicKey: keypair.publicKey,
              dkimStatus: "PENDING" as const
            };
          })()
        : {
            ...base,
            dkimMode: "EXTERNAL" as const,
            dkimStatus: "NA" as const
          };

    try {
      const created = await prisma.sendingDomain.create({
        data,
        select: sendingDomainSelect
      });
      return withDnsRecords(created);
    } catch (error) {
      throw mapDuplicateDomain(error);
    }
  },

  async update(id: string, userId: string, input: SendingDomainUpdateInput) {
    await findOwned(id, userId);
    const updated = await prisma.sendingDomain.update({
      where: { id },
      data: { spfNote: input.spfNote ?? null },
      select: sendingDomainSelect
    });
    return withDnsRecords(updated);
  },

  // Enqueue an on-demand DNS recheck for a managed domain. The worker performs
  // the actual lookup and updates dkimStatus/lastCheckedAt asynchronously.
  async verify(id: string, userId: string) {
    const domain = await findOwned(id, userId);
    if (domain.dkimMode !== "MANAGED") {
      throw new HttpError(
        400,
        "Only managed-DKIM domains are verified by QQueue."
      );
    }

    await dkimVerificationQueue.add(
      "verify-dkim",
      { sendingDomainId: id },
      {
        jobId: `dkim-${id}-${Date.now()}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 }
      }
    );

    return { status: "queued" as const };
  },

  async delete(id: string, userId: string) {
    await findOwned(id, userId);
    await prisma.sendingDomain.delete({ where: { id } });
  }
};

// Surface the (organizationId, domain) unique violation as a friendly 409 rather
// than the generic Prisma error.
function mapDuplicateDomain(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return new HttpError(409, "This domain is already registered.");
  }
  return error;
}
