import type { ImapFlow, FetchMessageObject } from "imapflow";
import { prisma } from "./prisma.js";
import { matchesRemoteIdentity } from "./inbox-folders.js";

type Folder = {
  id: string;
  inboxAccountId: string;
  uidValidity: string;
  flagsCursor?: number | null;
};
const include = { message: true } as const;

/** Shared Seen/Flagged actions converge across every current folder copy. */
export async function synchronizeReadState(client: ImapFlow, folder: Folder) {
  let retryNewerAction = false;
  const pending = await prisma.inboundMessageLocation.findMany({
    where: {
      inboxFolderId: folder.id,
      present: true,
      uidValidity: folder.uidValidity,
      message: { OR: [{ readPending: true }, { flagPending: true }] },
    },
    include,
    take: 200,
    orderBy: [{ attemptedAt: { sort: "asc", nulls: "first" } }, { uid: "asc" }],
  });
  for (const location of pending) {
    const message = location.message;
    try {
      let remote = await client.fetchOne(
        location.uid,
        { envelope: true },
        { uid: true }
      );
      if (remote && !remote.envelope?.messageId && location.contentHash)
        remote = await client.fetchOne(
          location.uid,
          { envelope: true, source: true },
          { uid: true }
        );
      if (
        !remote ||
        !matchesRemoteIdentity({
          messageId: message.messageId,
          remoteMessageId: remote.envelope?.messageId,
          accountId: folder.inboxAccountId,
          folderId: folder.id,
          uidValidity: folder.uidValidity,
          uid: location.uid,
          contentHash: location.contentHash,
          source: remote.source,
        })
      ) {
        await prisma.inboundMessageLocation.updateMany({
          where: { id: location.id },
          data: { present: false },
        });
        throw new Error(
          "The message has moved or disappeared from this folder. Check for new mail to reconcile its location."
        );
      }
      for (const field of ["read", "flag"] as const) {
        const reading = field === "read";
        const isPending = reading ? message.readPending : message.flagPending;
        const revision = reading ? message.readRevision : message.flagRevision;
        const applied = reading
          ? location.readAppliedRevision
          : location.flagAppliedRevision;
        if (!isPending || applied === revision) continue;
        const desired = reading ? Boolean(message.readAt) : message.flagged;
        const flag = reading ? "\\Seen" : "\\Flagged";
        const confirmed = desired
          ? await client.messageFlagsAdd(location.uid, [flag], { uid: true })
          : await client.messageFlagsRemove(location.uid, [flag], {
              uid: true,
            });
        if (!confirmed)
          throw new Error(
            "The mail server did not confirm the flag change. It will retry."
          );
        await prisma.inboundMessageLocation.updateMany({
          where: {
            id: location.id,
            present: true,
            uid: location.uid,
            uidValidity: folder.uidValidity,
          },
          data: reading
            ? { readAppliedRevision: revision, remoteSeen: desired }
            : { flagAppliedRevision: revision, remoteFlagged: desired },
        });
      }
      // Acknowledgement requires every current copy to carry this exact action.
      // A newer teammate action cannot be cleared by an older network response.
      for (const field of ["read", "flag"] as const) {
        const reading = field === "read";
        if (!(reading ? message.readPending : message.flagPending)) continue;
        const revision = reading ? message.readRevision : message.flagRevision;
        const result = await prisma.inboundMessage.updateMany({
          where: {
            id: message.id,
            ...(reading
              ? { readRevision: revision, readPending: true }
              : { flagRevision: revision, flagPending: true }),
            locations: {
              none: {
                present: true,
                folder: { present: true },
                ...(reading
                  ? { readAppliedRevision: { not: revision } }
                  : { flagAppliedRevision: { not: revision } }),
              },
            },
          },
          data: reading
            ? { readPending: false, readSyncError: null }
            : { flagPending: false, flagSyncError: null },
        });
        retryNewerAction ||= result.count === 0;
      }
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Mailbox flags could not sync. They will retry.";
      await prisma.inboundMessageLocation.updateMany({
        where: { id: location.id },
        data: { attemptedAt: new Date() },
      });
      await prisma.inboundMessage.updateMany({
        where: {
          id: message.id,
          readRevision: message.readRevision,
          readPending: true,
        },
        data: { readSyncError: detail },
      });
      await prisma.inboundMessage.updateMany({
        where: {
          id: message.id,
          flagRevision: message.flagRevision,
          flagPending: true,
        },
        data: { flagSyncError: detail },
      });
    }
  }

  const scope = {
    inboxFolderId: folder.id,
    present: true,
    uidValidity: folder.uidValidity,
  };
  let rows = await prisma.inboundMessageLocation.findMany({
    where: { ...scope, uid: { gt: folder.flagsCursor ?? 0 } },
    include,
    orderBy: { uid: "asc" },
    take: 200,
  });
  if (!rows.length && folder.flagsCursor)
    rows = await prisma.inboundMessageLocation.findMany({
      where: scope,
      include,
      orderBy: { uid: "asc" },
      take: 200,
    });
  const snapshots = new Map(rows.map((row) => [row.uid, row]));
  const remotes: FetchMessageObject[] = [];
  if (rows.length)
    for await (const remote of client.fetch(
      rows.map((row) => row.uid),
      { uid: true, flags: true, envelope: true },
      { uid: true }
    ))
      remotes.push(remote);
  // Do not issue another IMAP command while a FETCH iterator holds its lock.
  // Headerless moved messages need byte identity, so verify those afterwards.
  let hashChecks = 0;
  let limited = false;
  let lastProcessed = 0;
  for (let remote of remotes.sort((a, b) => a.uid - b.uid)) {
    const location = snapshots.get(remote.uid);
    if (!location) continue;
    if (!remote.envelope?.messageId && location.contentHash) {
      if (hashChecks >= 10) {
        limited = true;
        break;
      }
      hashChecks++;
      lastProcessed = remote.uid;
      try {
        const body = await client.fetchOne(
          remote.uid,
          { source: true, envelope: true, flags: true },
          { uid: true }
        );
        if (!body) continue;
        remote = body;
      } catch {
        continue;
      }
    }
    lastProcessed = remote.uid;
    if (
      !matchesRemoteIdentity({
        messageId: location.message.messageId,
        remoteMessageId: remote.envelope?.messageId,
        accountId: folder.inboxAccountId,
        folderId: folder.id,
        uidValidity: folder.uidValidity,
        uid: remote.uid,
        contentHash: location.contentHash,
        source: remote.source,
      })
    ) {
      await prisma.inboundMessageLocation.updateMany({
        where: { id: location.id },
        data: { present: false },
      });
      continue;
    }
    if (!remote.flags) continue; // An omitted flags response is not "all flags off".
    const message = location.message;
    const seen = remote.flags.has("\\Seen");
    const flagged = remote.flags.has("\\Flagged");
    for (const field of ["read", "flag"] as const) {
      const reading = field === "read";
      const previous = reading ? location.remoteSeen : location.remoteFlagged;
      const desired = reading ? seen : flagged;
      if (previous === desired) continue;
      // Only an external transition is a new shared action. An old copy of a
      // message is never allowed to undo a just-acknowledged local action.
      const revision = reading ? message.readRevision : message.flagRevision;
      const changed = await prisma.inboundMessage.updateMany({
        where: {
          id: message.id,
          ...(reading
            ? { readRevision: revision, readPending: false }
            : { flagRevision: revision, flagPending: false }),
        },
        data: reading
          ? {
              readAt: seen ? new Date() : null,
              readRevision: { increment: 1 },
              readPending: true,
              readSyncError: null,
            }
          : {
              flagged,
              flagRevision: { increment: 1 },
              flagPending: true,
              flagSyncError: null,
            },
      });
      if (changed.count) {
        await prisma.inboundMessageLocation.updateMany({
          where: { id: location.id },
          data: reading
            ? { readAppliedRevision: revision + 1 }
            : { flagAppliedRevision: revision + 1 },
        });
        retryNewerAction = true;
      }
    }
    await prisma.inboundMessageLocation.updateMany({
      where: { id: location.id },
      data: {
        remoteSeen: seen,
        remoteFlagged: flagged,
        observedAt: new Date(),
      },
    });
  }
  // Expunges/moves are location changes, never deletion of cached writing.
  const returned = new Set(remotes.map((remote) => remote.uid));
  const missing = rows.filter((row) => !returned.has(row.uid));
  if (missing.length)
    await prisma.inboundMessageLocation.updateMany({
      where: { id: { in: missing.map((row) => row.id) } },
      data: { present: false },
    });
  await prisma.inboxFolder.update({
    where: { id: folder.id },
    data: {
      flagsCursor: limited
        ? lastProcessed
        : rows.length < 200
          ? 0
          : rows.at(-1)!.uid,
    },
  });
  return retryNewerAction;
}
