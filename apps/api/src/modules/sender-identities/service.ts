import type {
  SenderIdentityInput,
  SenderIdentityUpdateInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

const senderIdentitySelect = {
  id: true,
  organizationId: true,
  sendingDomainId: true,
  fromName: true,
  fromEmail: true,
  smtpConnectionId: true,
  replyTo: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true
};

// At most one default identity per org, mirroring SMTPConnection.isDefault.
// Returns the effective isDefault to persist: forced true when explicitly set,
// or true automatically when this is the org's first identity.
async function normalizeDefault(
  organizationId: string,
  isDefault: boolean | undefined,
  excludeId?: string
) {
  if (isDefault) {
    await prisma.senderIdentity.updateMany({
      where: { organizationId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      data: { isDefault: false }
    });
    return true;
  }

  const existingDefault = await prisma.senderIdentity.findFirst({
    where: {
      organizationId,
      isDefault: true,
      ...(excludeId ? { id: { not: excludeId } } : {})
    }
  });

  return !existingDefault;
}

async function findOwned(id: string, userId: string) {
  const identity = await prisma.senderIdentity.findFirst({
    where: { id, organization: { members: { some: { userId } } } }
  });
  if (!identity) {
    throw new HttpError(404, "Sender identity not found");
  }
  return identity;
}

// Confirm the chosen sending domain belongs to the org and that the From address
// actually lives under it (e.g. noreply@acme.com requires the acme.com domain).
async function assertDomainHostsEmail(
  organizationId: string,
  sendingDomainId: string,
  fromEmail: string
) {
  const domain = await prisma.sendingDomain.findFirst({
    where: { id: sendingDomainId, organizationId }
  });
  if (!domain) {
    throw new HttpError(400, "Sending domain not found for this organization.");
  }

  const emailDomain = fromEmail.split("@")[1]?.toLowerCase();
  if (emailDomain !== domain.domain.toLowerCase()) {
    throw new HttpError(
      400,
      `The From address must be on the sending domain (@${domain.domain}).`
    );
  }
}

// Confirm the SMTP credential that will transport this identity belongs to the org.
async function assertSmtpConnectionInOrg(
  organizationId: string,
  smtpConnectionId: string
) {
  const connection = await prisma.sMTPConnection.findFirst({
    where: { id: smtpConnectionId, organizationId }
  });
  if (!connection) {
    throw new HttpError(
      400,
      "SMTP connection not found for this organization."
    );
  }
}

export const senderIdentityService = {
  list(organizationId: string) {
    return prisma.senderIdentity.findMany({
      where: { organizationId },
      select: senderIdentitySelect,
      orderBy: { createdAt: "desc" }
    });
  },

  async get(id: string, userId: string) {
    await findOwned(id, userId);
    return prisma.senderIdentity.findUnique({
      where: { id },
      select: senderIdentitySelect
    });
  },

  async create(input: SenderIdentityInput) {
    await assertDomainHostsEmail(
      input.organizationId,
      input.sendingDomainId,
      input.fromEmail
    );
    await assertSmtpConnectionInOrg(
      input.organizationId,
      input.smtpConnectionId
    );

    const isDefault = await normalizeDefault(
      input.organizationId,
      input.isDefault
    );

    try {
      return await prisma.senderIdentity.create({
        data: {
          organizationId: input.organizationId,
          sendingDomainId: input.sendingDomainId,
          fromName: input.fromName,
          fromEmail: input.fromEmail,
          smtpConnectionId: input.smtpConnectionId,
          replyTo: input.replyTo ?? null,
          isDefault
        },
        select: senderIdentitySelect
      });
    } catch (error) {
      throw mapDuplicateEmail(error);
    }
  },

  async update(id: string, userId: string, input: SenderIdentityUpdateInput) {
    const existing = await findOwned(id, userId);

    if (input.smtpConnectionId) {
      await assertSmtpConnectionInOrg(
        existing.organizationId,
        input.smtpConnectionId
      );
    }

    const isDefault =
      input.isDefault === undefined
        ? existing.isDefault
        : await normalizeDefault(
            existing.organizationId,
            input.isDefault,
            existing.id
          );

    return prisma.senderIdentity.update({
      where: { id },
      data: {
        fromName: input.fromName,
        smtpConnectionId: input.smtpConnectionId,
        replyTo: input.replyTo === undefined ? undefined : input.replyTo,
        isDefault
      },
      select: senderIdentitySelect
    });
  },

  async delete(id: string, userId: string) {
    await findOwned(id, userId);
    await prisma.senderIdentity.delete({ where: { id } });
  }
};

function mapDuplicateEmail(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return new HttpError(
      409,
      "A sender identity with this From address already exists."
    );
  }
  return error;
}
