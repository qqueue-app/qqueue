import type {
  SendingDomainInput,
  SendingDomainUpdateInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

// Public shape: never expose the encrypted private key to clients.
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
  list(organizationId: string) {
    return prisma.sendingDomain.findMany({
      where: { organizationId },
      select: sendingDomainSelect,
      orderBy: { createdAt: "desc" }
    });
  },

  async get(id: string, userId: string) {
    await findOwned(id, userId);
    return prisma.sendingDomain.findUnique({
      where: { id },
      select: sendingDomainSelect
    });
  },

  async create(input: SendingDomainInput) {
    // Sprint 1 ships EXTERNAL mode only (trust the upstream server/relay to sign
    // DKIM). MANAGED mode requires server-side keypair generation + DNS
    // verification, which arrives in a later sprint; reject it clearly until then.
    if (input.dkimMode === "MANAGED") {
      throw new HttpError(
        400,
        "Managed DKIM signing is not available yet. Choose external mode if your mail server or relay already signs DKIM for this domain."
      );
    }

    try {
      return await prisma.sendingDomain.create({
        data: {
          organizationId: input.organizationId,
          domain: input.domain,
          dkimMode: "EXTERNAL",
          // Nothing for QQueue to verify in external mode.
          dkimStatus: "NA",
          spfNote: input.spfNote ?? null
        },
        select: sendingDomainSelect
      });
    } catch (error) {
      throw mapDuplicateDomain(error);
    }
  },

  async update(id: string, userId: string, input: SendingDomainUpdateInput) {
    await findOwned(id, userId);
    return prisma.sendingDomain.update({
      where: { id },
      data: { spfNote: input.spfNote ?? null },
      select: sendingDomainSelect
    });
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
