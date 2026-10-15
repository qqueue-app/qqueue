import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { InboxMoveInput } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  inboundMessageScope,
  resolveMailboxAccess,
} from "../../lib/mailbox-access.js";
import { prisma } from "../../lib/prisma.js";
import { inboxService } from "./service.js";

const outcome = {
  id: true,
  inboundMessageId: true,
  batchId: true,
  sourceLocationId: true,
  sourceFolderId: true,
  targetFolderId: true,
  sourcePath: true,
  targetPath: true,
  action: true,
  status: true,
  error: true,
  createdAt: true,
} satisfies Prisma.InboxMoveSelect;
const batchSelect = {
  id: true,
  clientId: true,
  createdAt: true,
  moves: {
    select: outcome,
    orderBy: [{ status: "desc" as const }, { createdAt: "asc" as const }],
    take: 20,
  },
};
const active = ["PENDING", "PROCESSING", "UNCERTAIN"];

async function withCounts<T extends { id: string }>(
  batch: T,
  scope: Prisma.InboxMoveWhereInput = {}
) {
  const grouped = await prisma.inboxMove.groupBy({
    by: ["status"],
    where: { ...scope, batchId: batch.id },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {
    PENDING: 0,
    PROCESSING: 0,
    UNCERTAIN: 0,
    DONE: 0,
    FAILED: 0,
  };
  for (const row of grouped) counts[row.status] = row._count._all;
  return {
    ...batch,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

export const inboxMoveService = {
  async create(
    messageId: string,
    organizationId: string,
    userId: string,
    input: InboxMoveInput
  ) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const seed = await prisma.inboundMessage.findFirst({
      where: { id: messageId, organizationId, ...inboundMessageScope(access) },
      include: { inboxAccount: { select: { status: true } } },
    });
    if (!seed) throw new HttpError(404, "Message not found", "not_found");
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          messageId,
          sourceLocationId: input.sourceLocationId,
          action: input.action,
          targetFolderId: input.targetFolderId ?? null,
          scope: input.scope,
        })
      )
      .digest("hex");
    const result = await prisma.$transaction(
      async (db) => {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"inbox-move-create:" + seed.inboxAccountId}, 0))`;
        const existing = await db.inboxMoveBatch.findUnique({
          where: {
            organizationId_userId_clientId: {
              organizationId,
              userId,
              clientId: input.clientId,
            },
          },
          select: { ...batchSelect, requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new HttpError(
              409,
              "This move retry has different instructions. Check its status before starting another move.",
              "conflict"
            );
          return {
            id: existing.id,
            clientId: existing.clientId,
            createdAt: existing.createdAt,
            moves: existing.moves,
          };
        }
        if (seed.inboxAccount.status !== "ACTIVE")
          throw new HttpError(
            409,
            "Reconnect this mailbox before moving mail.",
            "conflict"
          );
        const source = await db.inboundMessageLocation.findFirst({
          where: {
            id: input.sourceLocationId,
            inboundMessageId: seed.id,
            present: true,
            folder: { inboxAccountId: seed.inboxAccountId, present: true },
          },
          include: { folder: true },
        });
        if (!source)
          throw new HttpError(
            409,
            "This message is no longer in the selected folder. Check for new mail to refresh its location.",
            "conflict"
          );
        const folders = await db.inboxFolder.findMany({
          where: { inboxAccountId: seed.inboxAccountId, present: true },
        });
        let target =
          input.action === "MOVE"
            ? folders.find((folder) => folder.id === input.targetFolderId)
            : input.action === "TRASH"
              ? folders.find((folder) => folder.role === "TRASH")
              : input.action === "ARCHIVE"
                ? (folders.find((folder) => folder.role === "ARCHIVE") ??
                  folders.find((folder) => folder.role === "ALL"))
                : undefined;
        if (input.action === "RESTORE") {
          if (source.folder.role !== "TRASH")
            throw new HttpError(
              409,
              "Restore is available for mail in Trash. Use Move to choose another folder.",
              "conflict"
            );
          const previous = await db.inboxMove.findFirst({
            where: {
              inboundMessageId: seed.id,
              targetFolderId: source.inboxFolderId,
              status: "DONE",
            },
            orderBy: { createdAt: "desc" },
            select: { sourceFolderId: true },
          });
          target =
            folders.find((folder) => folder.id === previous?.sourceFolderId) ??
            folders.find((folder) => folder.role === "INBOX") ??
            folders.find((folder) => folder.isPrimary);
        }
        if (!target)
          throw new HttpError(
            409,
            "The destination folder is unavailable. Check for new mail or ask an administrator to configure this mailbox's folders.",
            "conflict"
          );
        if (target.id === source.inboxFolderId)
          throw new HttpError(
            409,
            "This message is already in that folder.",
            "conflict"
          );
        const ids =
          input.scope === "CONVERSATION"
            ? (
                await inboxService.getConversation(
                  seed.id,
                  organizationId,
                  userId
                )
              ).messages.map((message) => message.id)
            : [seed.id];
        const locations = await db.inboundMessageLocation.findMany({
          where: {
            inboundMessageId: { in: ids },
            inboxFolderId: source.inboxFolderId,
            present: true,
          },
        });
        if (!locations.length)
          throw new HttpError(
            409,
            "These messages have already left this folder. Check for new mail.",
            "conflict"
          );
        const inProgress = await db.inboxMove.findFirst({
          where: {
            sourceLocationId: { in: locations.map((location) => location.id) },
            status: { in: active },
          },
          select: { id: true },
        });
        if (inProgress)
          throw new HttpError(
            409,
            "A move for this conversation is still being checked. Wait for its status before moving it again.",
            "conflict"
          );
        const batch = await db.inboxMoveBatch.create({
          data: {
            organizationId,
            userId,
            clientId: input.clientId,
            requestHash,
          },
          select: { id: true },
        });
        await db.inboxMove.createMany({
          data: locations.map((location) => ({
            id: randomUUID(),
            organizationId,
            userId,
            inboundMessageId: location.inboundMessageId,
            batchId: batch.id,
            inboxAccountId: seed.inboxAccountId,
            sourceLocationId: location.id,
            sourceFolderId: source.inboxFolderId,
            targetFolderId: target!.id,
            sourcePath: source.folder.path,
            targetPath: target!.path,
            sourceUid: location.uid,
            sourceUidValidity: location.uidValidity,
            action: input.action,
          })),
        });
        return db.inboxMoveBatch.findUniqueOrThrow({
          where: { id: batch.id },
          select: batchSelect,
        });
      },
      { timeout: 30_000 }
    );
    // Acceptance is durable even if Redis is unavailable. Periodic account
    // checks recover pending move intents; browser retries return this batch.
    await inboxService
      .requestSync(organizationId, userId, seed.inboxAccountId)
      .catch(() => undefined);
    return withCounts(result);
  },
  async getBatch(batchId: string, organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const scope = { organizationId, message: inboundMessageScope(access) };
    const batch = await prisma.inboxMoveBatch.findFirst({
      where: { id: batchId, organizationId, moves: { some: scope } },
      select: { ...batchSelect, moves: { ...batchSelect.moves, where: scope } },
    });
    if (!batch) throw new HttpError(404, "Move not found", "not_found");
    return withCounts(batch, scope);
  },
  async recent(messageId: string, organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const message = await prisma.inboundMessage.findFirst({
      where: { id: messageId, organizationId, ...inboundMessageScope(access) },
      select: { id: true },
    });
    if (!message) throw new HttpError(404, "Message not found", "not_found");
    const scope = { organizationId, message: inboundMessageScope(access) };
    const batches = await prisma.inboxMoveBatch.findMany({
      where: {
        organizationId,
        moves: { some: { inboundMessageId: messageId } },
      },
      select: { ...batchSelect, moves: { ...batchSelect.moves, where: scope } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    return Promise.all(batches.map((batch) => withCounts(batch, scope)));
  },
  async check(messageId: string, organizationId: string, userId: string) {
    const access = await resolveMailboxAccess(userId, organizationId);
    const message = await prisma.inboundMessage.findFirst({
      where: { id: messageId, organizationId, ...inboundMessageScope(access) },
      select: { inboxAccountId: true },
    });
    if (!message) throw new HttpError(404, "Message not found", "not_found");
    await inboxService
      .requestSync(organizationId, userId, message.inboxAccountId)
      .catch(() => undefined);
    return { queued: true };
  },
};
