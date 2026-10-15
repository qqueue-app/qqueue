import type { ImapFlow } from "imapflow";
import { prisma } from "./prisma.js";

/** Apply durable shared actions before reconciling other clients' Seen flags. */
export async function synchronizeReadState(
  client: ImapFlow,
  account: {
    id: string;
    uidValidity?: string | null;
    flagsCursor?: number | null;
  }
) {
  let retryNewerAction = false;
  const pending = await prisma.inboundMessage.findMany({
    where: { inboxAccountId: account.id, readPending: true },
    select: {
      id: true,
      messageId: true,
      imapUid: true,
      imapUidValidity: true,
      readAt: true,
      readRevision: true,
    },
    take: 200,
    // Failed/stale locations must not permanently block the next 200 actions.
    // Rotate failures behind untouched work on every attempt.
    orderBy: { readAttemptedAt: { sort: "asc", nulls: "first" } },
  });
  for (const message of pending) {
    try {
      if (!message.imapUid || message.imapUidValidity !== account.uidValidity)
        throw new Error(
          "This message's mail-server location needs to be reconciled before its read state can sync."
        );
      const remote = await client.fetchOne(
        message.imapUid,
        { envelope: true },
        { uid: true }
      );
      const remoteIdentity =
        remote &&
        (remote.envelope?.messageId ??
          `${account.id}:${account.uidValidity}:${message.imapUid}`);
      const legacyIdentity =
        remote &&
        !remote.envelope?.messageId &&
        message.messageId === `${account.id}:${message.imapUid}`;
      if (!remote || (remoteIdentity !== message.messageId && !legacyIdentity))
        throw new Error(
          "The message is no longer at this mail-server location. Check for new mail to reconcile it."
        );
      const applied = message.readAt
        ? await client.messageFlagsAdd(message.imapUid, ["\\Seen"], {
            uid: true,
          })
        : await client.messageFlagsRemove(message.imapUid, ["\\Seen"], {
            uid: true,
          });
      if (!applied)
        throw new Error(
          "The mail server did not confirm the read-state change."
        );
      // An action taken while IMAP was responding keeps its newer revision and
      // remains pending. The next pass applies that newer action.
      const acknowledged = await prisma.inboundMessage.updateMany({
        where: {
          id: message.id,
          readRevision: message.readRevision,
          readPending: true,
        },
        data: { readPending: false, readSyncError: null },
      });
      retryNewerAction ||= acknowledged.count === 0;
    } catch (error) {
      await prisma.inboundMessage.updateMany({
        where: {
          id: message.id,
          readRevision: message.readRevision,
          readPending: true,
        },
        data: {
          readAttemptedAt: new Date(),
          readSyncError:
            error instanceof Error
              ? error.message
              : "Read-state sync failed. It will retry when the mailbox reconnects.",
        },
      });
    }
  }

  // Bounded, round-robin flag reconciliation also notices Seen changes made
  // in another client on older messages, without downloading their bodies.
  let rows = await prisma.inboundMessage.findMany({
    where: {
      inboxAccountId: account.id,
      imapUidValidity: account.uidValidity,
      imapUid: { gt: account.flagsCursor ?? 0 },
    },
    select: { id: true, imapUid: true, readRevision: true },
    orderBy: { imapUid: "asc" },
    take: 200,
  });
  if (!rows.length && account.flagsCursor) {
    rows = await prisma.inboundMessage.findMany({
      where: {
        inboxAccountId: account.id,
        imapUidValidity: account.uidValidity,
        imapUid: { gt: 0 },
      },
      select: { id: true, imapUid: true, readRevision: true },
      orderBy: { imapUid: "asc" },
      take: 200,
    });
  }
  if (!rows.length) {
    await prisma.inboxAccount.update({
      where: { id: account.id },
      data: { flagsCursor: 0 },
    });
    return retryNewerAction;
  }
  const snapshots = new Map(rows.map((row) => [row.imapUid!, row]));
  for await (const flags of client.fetch(
    rows.map((row) => row.imapUid!),
    { uid: true, flags: true },
    { uid: true }
  )) {
    const snapshot = snapshots.get(flags.uid);
    if (!snapshot) continue;
    await prisma.inboundMessage.updateMany({
      where: {
        id: snapshot.id,
        readRevision: snapshot.readRevision,
        readPending: false,
        imapUid: flags.uid,
        imapUidValidity: account.uidValidity,
      },
      data: {
        readAt: flags.flags?.has("\\Seen") ? new Date() : null,
        readSyncError: null,
      },
    });
  }
  await prisma.inboxAccount.update({
    where: { id: account.id },
    data: { flagsCursor: rows.length < 200 ? 0 : rows.at(-1)!.imapUid },
  });
  return retryNewerAction;
}
