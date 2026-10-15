import type { MailSignatureInput } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/http-error.js";
import { resolveMailboxAccess } from "../../lib/mailbox-access.js";
import { assertMayUseConnection } from "../../lib/send-as.js";

export const mailPreferenceService = {
  async signatures(organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const accounts = await prisma.sMTPConnection.findMany({
      where: {
        organizationId,
        ...(access.unrestricted
          ? {}
          : { id: { in: access.smtpConnectionIds } }),
      },
      select: {
        id: true,
        fromEmail: true,
        fromName: true,
        isDefault: true,
        mailSignatures: {
          where: { userId },
          select: { text: true, enabled: true, revision: true },
        },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return accounts.map((account) => ({
      smtpConnectionId: account.id,
      fromEmail: account.fromEmail,
      fromName: account.fromName,
      isDefault: account.isDefault,
      text: account.mailSignatures[0]?.text ?? "",
      enabled: account.mailSignatures[0]?.enabled ?? false,
      revision: account.mailSignatures[0]?.revision ?? 0,
    }));
  },
  async saveSignature(
    organizationId: string,
    userId: string,
    input: MailSignatureInput
  ) {
    await assertMayUseConnection({
      organizationId,
      userId,
      smtpConnectionId: input.smtpConnectionId,
    });
    const account = await prisma.sMTPConnection.findFirst({
      where: { id: input.smtpConnectionId, organizationId },
      select: { id: true },
    });
    if (!account)
      throw new HttpError(404, "Sending account not found", "not_found");
    return prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`signature:${userId}:${account.id}`},0))`;
      const where = {
        userId_smtpConnectionId: { userId, smtpConnectionId: account.id },
      };
      const existing = await db.mailSignature.findUnique({ where });
      if (
        existing &&
        existing.revision === input.expectedRevision + 1 &&
        existing.text === input.text &&
        existing.enabled === input.enabled
      )
        return existing;
      if ((existing?.revision ?? 0) !== input.expectedRevision)
        throw new HttpError(
          409,
          "This signature changed on another device. Your version is kept here; reload the saved version to compare before saving again.",
          "conflict"
        );
      const data = { text: input.text, enabled: input.enabled };
      return existing
        ? db.mailSignature.update({
            where,
            data: { ...data, revision: { increment: 1 } },
          })
        : db.mailSignature.create({
            data: {
              ...data,
              userId,
              organizationId,
              smtpConnectionId: account.id,
            },
          });
    });
  },
};
