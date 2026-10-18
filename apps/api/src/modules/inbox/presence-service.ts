import { HttpError } from "../../lib/http-error.js";
import {
  inboundMessageScope,
  resolveMailboxAccess,
} from "../../lib/mailbox-access.js";
import { prisma } from "../../lib/prisma.js";

export const REPLY_PRESENCE_TTL_MS = 45_000;
export const replyPresenceService = {
  async touch(
    messageId: string,
    organizationId: string,
    userId: string,
    clientId: string
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const message = await prisma.inboundMessage.findFirst({
      where: { id: messageId, organizationId, ...inboundMessageScope(access) },
      select: { id: true },
    });
    if (!message) throw new HttpError(404, "Message not found", "not_found");
    const now = new Date();
    await prisma.replyPresence.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    const expiresAt = new Date(now.getTime() + REPLY_PRESENCE_TTL_MS);
    await prisma.replyPresence.upsert({
      where: {
        organizationId_userId_clientId: { organizationId, userId, clientId },
      },
      create: {
        organizationId,
        userId,
        clientId,
        inboundMessageId: message.id,
        expiresAt,
      },
      update: { inboundMessageId: message.id, expiresAt },
    });
    return { expiresAt };
  },
  async leave(organizationId: string, userId: string, clientId: string) {
    // A revoked reader may always remove their own indicator, never someone else's.
    await prisma.replyPresence.deleteMany({
      where: { organizationId, userId, clientId },
    });
    return { left: true };
  },
  async list(
    organizationId: string,
    inboxAccountId: string,
    messageIds: string[]
  ) {
    // Called only after the conversation's read authorization. Re-check active
    // participants' current membership/grants so revoked access disappears now.
    const rows = await prisma.replyPresence.findMany({
      where: {
        organizationId,
        inboundMessageId: { in: messageIds },
        expiresAt: { gt: new Date() },
        user: {
          members: { some: { organizationId } },
          OR: [
            {
              members: {
                some: { organizationId, role: "OWNER" },
              },
            },
            {
              members: { some: { organizationId, role: "ADMIN" } },
              inboxGrants: {
                none: { organizationId, inboxAccountId, revoked: true },
              },
            },
            {
              inboxGrants: {
                some: { organizationId, inboxAccountId, revoked: false },
              },
            },
          ],
        },
      },
      select: {
        clientId: true,
        userId: true,
        expiresAt: true,
        user: { select: { name: true } },
      },
      orderBy: [{ expiresAt: "desc" }, { id: "asc" }],
      take: 50,
    });
    return (rows ?? []).map(({ user, ...row }) => ({
      ...row,
      name: user.name || "A teammate",
    }));
  },
};
