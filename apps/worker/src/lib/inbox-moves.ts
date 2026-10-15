import { createHash } from "node:crypto";
import type { InboxMove } from "@prisma/client";
import type { FetchMessageObject, ImapFlow } from "imapflow";
import { matchesRemoteIdentity } from "./inbox-folders.js";
import { prisma } from "./prisma.js";

type Move = InboxMove & { message: { messageId: string } };
function digest(source: Uint8Array) {
  return createHash("sha256").update(source).digest("hex");
}
const uncertain =
  "The mail server's move outcome is not confirmed. Your cached message is kept. Check status or inspect this folder in another mail client; this command will not be repeated automatically.";

async function status(
  move: Move,
  value: "FAILED" | "UNCERTAIN",
  error: string
) {
  await prisma.inboxMove.updateMany({
    where: { id: move.id, status: { not: "DONE" } },
    data: { status: value, error, attemptedAt: new Date() },
  });
}

async function findDestination(
  client: ImapFlow,
  move: Move,
  assertAlive: () => void
) {
  const box = await client.mailboxOpen(move.targetPath, { readOnly: false });
  assertAlive();
  if (box.uidValidity?.toString() !== move.targetUidValidity) return null;
  async function inspect(uid: number) {
    const message = await client.fetchOne(
      uid,
      { uid: true, source: true, flags: true, envelope: true },
      { uid: true }
    );
    assertAlive();
    return message &&
      message.source &&
      digest(message.source) === move.sourceHash
      ? message
      : null;
  }
  if (move.targetUid) {
    const known = await inspect(move.targetUid);
    if (known) return known;
  }
  if (move.sourceHeaderId) {
    const query = { header: { "message-id": move.sourceHeaderId } };
    const counted = await client.search(query, {
      uid: true,
      returnOptions: ["COUNT"],
    });
    if (
      !counted ||
      (Array.isArray(counted) ? counted.length : (counted.count ?? 0)) > 25
    )
      return null;
    const result = Array.isArray(counted)
      ? counted
      : await client.search(query, { uid: true });
    if (!Array.isArray(result) || result.length > 25) return null;
    for (const uid of result) {
      const message = await inspect(uid);
      if (message) return message;
    }
  } else if (move.targetUidNext && box.uidNext > move.targetUidNext) {
    // A headerless message is identifiable by its original bytes, in a bounded
    // destination window recorded before the command. Never guess from a UID.
    const last = Math.min(box.uidNext - 1, move.targetUidNext + 24);
    for await (const message of client.fetch(
      `${move.targetUidNext}:${last}`,
      { uid: true, source: true, flags: true },
      { uid: true }
    )) {
      assertAlive();
      if (message.source && digest(message.source) === move.sourceHash)
        return message;
    }
  }
  return null;
}

async function finish(move: Move, destination: FetchMessageObject) {
  const seen = destination.flags?.has("\\Seen");
  const flagged = destination.flags?.has("\\Flagged");
  await prisma.$transaction(async (db) => {
    const message = await db.inboundMessage.findUniqueOrThrow({
      where: { id: move.inboundMessageId },
    });
    const key = {
      inboxFolderId: move.targetFolderId,
      uidValidity: move.targetUidValidity!,
      uid: destination.uid,
    };
    const oldTarget = await db.inboundMessageLocation.findUnique({
      where: { inboxFolderId_uidValidity_uid: key },
    });
    if (oldTarget && oldTarget.inboundMessageId !== message.id)
      throw new Error(
        "The destination is already attached to a different cached message. Check its identity in another client."
      );
    const sameRead = seen !== undefined && seen === Boolean(message.readAt);
    const sameFlag = flagged !== undefined && flagged === message.flagged;
    await db.inboundMessageLocation.updateMany({
      where: {
        id: move.sourceLocationId,
        inboundMessageId: message.id,
        uid: move.sourceUid,
        uidValidity: move.sourceUidValidity,
      },
      data: { present: false },
    });
    await db.inboundMessageLocation.upsert({
      where: { inboxFolderId_uidValidity_uid: key },
      create: {
        ...key,
        inboundMessageId: message.id,
        contentHash: move.sourceHash,
        remoteSeen: seen ?? Boolean(message.readAt),
        remoteFlagged: flagged ?? message.flagged,
        readAppliedRevision: sameRead ? message.readRevision : 0,
        flagAppliedRevision: sameFlag ? message.flagRevision : 0,
      },
      update: {
        present: true,
        contentHash: move.sourceHash,
        observedAt: new Date(),
      },
    });
    await db.inboundMessage.updateMany({
      where: {
        id: message.id,
        readRevision: message.readRevision,
        flagRevision: message.flagRevision,
      },
      data: {
        imapUid: destination.uid,
        imapUidValidity: move.targetUidValidity,
        ...(!sameRead ? { readPending: true } : {}),
        ...(!sameFlag ? { flagPending: true } : {}),
      },
    });
    await db.inboxMove.update({
      where: { id: move.id },
      data: {
        status: "DONE",
        targetUid: destination.uid,
        error: null,
        attemptedAt: new Date(),
      },
    });
  });
}

async function reconcile(
  client: ImapFlow,
  move: Move,
  assertAlive: () => void
) {
  if (!move.sourceHash || !move.targetUidValidity) {
    await status(move, "UNCERTAIN", uncertain);
    return;
  }
  const source = await client.mailboxOpen(move.sourcePath, { readOnly: false });
  assertAlive();
  // A recreated source namespace cannot prove what happened to the old UID.
  if (source.uidValidity?.toString() !== move.sourceUidValidity) {
    await status(move, "UNCERTAIN", uncertain);
    return;
  }
  const original = await client.fetchOne(
    move.sourceUid,
    { uid: true },
    { uid: true }
  );
  assertAlive();
  const destination = await findDestination(client, move, assertAlive);
  if (!original && destination) await finish(move, destination);
  else await status(move, "UNCERTAIN", uncertain);
}

/** Runs under the account sync lock. PROCESSING from an earlier pass means
 * "outcome unknown", never permission to send the MOVE command again. */
export async function processInboxMoves(
  client: ImapFlow,
  inboxAccountId: string,
  assertAlive: () => void
) {
  const moves = await prisma.inboxMove.findMany({
    where: {
      inboxAccountId,
      status: { in: ["PENDING", "PROCESSING", "UNCERTAIN"] },
    },
    include: { message: { select: { messageId: true } } },
    take: 50,
    orderBy: [
      { attemptedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
    ],
  });
  for (let move of moves) {
    assertAlive();
    let commandAttempted = move.status !== "PENDING";
    try {
      await prisma.inboxMove.updateMany({
        where: { id: move.id },
        data: { attemptedAt: new Date() },
      });
      if (move.status !== "PENDING") {
        await reconcile(client, move, assertAlive);
        continue;
      }
      if (!client.capabilities.has("MOVE")) {
        await status(
          move,
          "FAILED",
          "This mail server does not support safe folder moves. Use another mail client for this action or ask an administrator to enable IMAP MOVE."
        );
        continue;
      }
      const target = await prisma.inboxFolder.findFirst({
        where: { id: move.targetFolderId, inboxAccountId, present: true },
      });
      if (!target || target.path !== move.targetPath) {
        await status(
          move,
          "FAILED",
          "The destination folder changed or disappeared. Check for new mail before trying again."
        );
        continue;
      }
      const location = await prisma.inboundMessageLocation.findFirst({
        where: {
          id: move.sourceLocationId,
          inboundMessageId: move.inboundMessageId,
          present: true,
          uid: move.sourceUid,
          uidValidity: move.sourceUidValidity,
          folder: { inboxAccountId, present: true },
        },
      });
      if (!location) {
        await status(
          move,
          "FAILED",
          "The source location changed. Check for new mail before trying again."
        );
        continue;
      }
      const targetBox = await client.mailboxOpen(move.targetPath, {
        readOnly: false,
      });
      assertAlive();
      if (!targetBox.uidValidity)
        throw new Error(
          "The server did not confirm the destination folder identity."
        );
      const sourceBox = await client.mailboxOpen(move.sourcePath, {
        readOnly: false,
      });
      assertAlive();
      if (sourceBox.uidValidity?.toString() !== move.sourceUidValidity) {
        await status(
          move,
          "FAILED",
          "The source folder changed. Check for new mail before trying again."
        );
        continue;
      }
      if (sourceBox.readOnly) {
        await status(
          move,
          "FAILED",
          "The mail server opened the source folder as read-only. Ask an administrator to check this mailbox's permissions."
        );
        continue;
      }
      const remote = await client.fetchOne(
        move.sourceUid,
        { source: true, envelope: true },
        { uid: true }
      );
      assertAlive();
      if (
        !remote ||
        !remote.source ||
        !matchesRemoteIdentity({
          messageId: move.message.messageId,
          remoteMessageId: remote.envelope?.messageId,
          accountId: inboxAccountId,
          folderId: move.sourceFolderId,
          uidValidity: move.sourceUidValidity,
          uid: move.sourceUid,
          contentHash: location.contentHash,
          source: remote.source,
        })
      ) {
        await status(
          move,
          "FAILED",
          "The original message is no longer at this folder location. Check for new mail before trying again."
        );
        continue;
      }
      const claim = await prisma.inboxMove.updateMany({
        where: { id: move.id, status: "PENDING" },
        data: {
          status: "PROCESSING",
          sourceHash: digest(remote.source),
          sourceHeaderId: remote.envelope?.messageId ?? null,
          targetUidValidity: targetBox.uidValidity.toString(),
          targetUidNext: targetBox.uidNext,
          error: null,
        },
      });
      if (!claim.count) continue;
      move = {
        ...move,
        sourceHash: digest(remote.source),
        sourceHeaderId: remote.envelope?.messageId ?? null,
        targetUidValidity: targetBox.uidValidity.toString(),
        targetUidNext: targetBox.uidNext,
        status: "PROCESSING",
      };
      commandAttempted = true;
      const result = await client.messageMove(move.sourceUid, move.targetPath, {
        uid: true,
      });
      assertAlive();
      if (result) {
        move = {
          ...move,
          targetUid: result.uidMap?.get(move.sourceUid) ?? null,
          targetUidValidity:
            result.uidValidity?.toString() ?? move.targetUidValidity,
        };
        await prisma.inboxMove.updateMany({
          where: { id: move.id },
          data: {
            targetUid: move.targetUid,
            targetUidValidity: move.targetUidValidity,
          },
        });
      }
      await reconcile(client, move, assertAlive);
    } catch (error) {
      await status(
        move,
        commandAttempted ? "UNCERTAIN" : "FAILED",
        commandAttempted
          ? uncertain
          : error instanceof Error
            ? error.message
            : "Could not prepare this folder move. Your message is kept."
      );
      assertAlive();
    }
  }
  return Boolean(
    await prisma.inboxMove.findFirst({
      where: { inboxAccountId, status: "PENDING" },
      select: { id: true },
    })
  );
}
