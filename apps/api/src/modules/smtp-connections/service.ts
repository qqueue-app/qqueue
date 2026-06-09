import { SMTPProvider } from "@qqueue/email-engine";
import type {
  SMTPConnectionInput,
  SMTPConnectionUpdateInput
} from "@qqueue/shared";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

const smtpConnectionSelect = {
  id: true,
  organizationId: true,
  name: true,
  host: true,
  port: true,
  secure: true,
  fromEmail: true,
  fromName: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true
};

async function normalizeDefault(
  organizationId: string,
  isDefault: boolean | undefined
) {
  if (isDefault) {
    await prisma.sMTPConnection.updateMany({
      where: { organizationId },
      data: { isDefault: false }
    });
    return true;
  }

  const existingDefault = await prisma.sMTPConnection.findFirst({
    where: { organizationId, isDefault: true }
  });

  return !existingDefault;
}

function toProvider(connection: {
  host: string;
  port: number;
  secure: boolean;
  usernameEncrypted: string;
  passwordEncrypted: string;
}) {
  return new SMTPProvider({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: {
      user: decryptSecret(connection.usernameEncrypted),
      pass: decryptSecret(connection.passwordEncrypted)
    }
  });
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
        usernameEncrypted: encryptSecret(input.username),
        passwordEncrypted: encryptSecret(input.password),
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        isDefault
      },
      select: smtpConnectionSelect
    });
  },

  async update(id: string, userId: string, input: SMTPConnectionUpdateInput) {
    const existing = await findOwned(id, userId);
    // Connections stay in their original org; we never move them across tenants.
    const organizationId = existing.organizationId;
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
        usernameEncrypted: input.username
          ? encryptSecret(input.username)
          : undefined,
        passwordEncrypted: input.password
          ? encryptSecret(input.password)
          : undefined,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        isDefault
      },
      select: smtpConnectionSelect
    });
  },

  async delete(id: string, userId: string) {
    await findOwned(id, userId);
    await prisma.sMTPConnection.delete({ where: { id } });
  },

  async test(id: string, userId: string) {
    const connection = await findOwned(id, userId);

    try {
      await toProvider(connection).verify();
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error
          ? `SMTP verification failed: ${error.message}`
          : "SMTP verification failed"
      );
    }

    return {
      id: connection.id,
      ok: true
    };
  },

  getProviderForConnection(connection: {
    host: string;
    port: number;
    secure: boolean;
    usernameEncrypted: string;
    passwordEncrypted: string;
  }) {
    return toProvider(connection);
  }
};
