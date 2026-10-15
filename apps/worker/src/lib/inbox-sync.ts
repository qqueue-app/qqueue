import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { ImapFlow, type SearchObject } from "imapflow";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { env } from "../config/env.js";
import { decryptSecret } from "./crypto.js";
import { applyDsnBounce, parseDsn } from "./dsn.js";
import { discoverFolders, matchesRemoteIdentity } from "./inbox-folders.js";
import { synchronizeReadState } from "./inbox-read-state.js";
import { processInboxMoves } from "./inbox-moves.js";
import { inboxSyncQueue } from "../queues/inbox-sync.queue.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import { notifyNewInboundMessage } from "./push.js";
import { storage } from "./storage.js";

type InboxAccount = Awaited<ReturnType<typeof getActiveInboxAccounts>>[number];
type SyncedAccount = InboxAccount & { folderId: string; folderRole: string };

function addressList(value?: AddressObject | AddressObject[]) {
  const objects = Array.isArray(value) ? value : value ? [value] : [];
  return objects.flatMap((object) =>
    object.value
      .map((entry) => entry.address?.toLowerCase())
      .filter((address): address is string => Boolean(address))
  );
}

function firstAddress(value?: AddressObject) {
  const first = value?.value[0];
  return {
    email: first?.address?.toLowerCase() ?? "unknown@example.invalid",
    name: first?.name,
  };
}

function normalizeReferences(mail: ParsedMail) {
  const raw = mail.references;
  if (!raw) {
    return [];
  }
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
}

async function findOutboundThread(input: {
  organizationId: string;
  inReplyTo?: string | null;
  references: string[];
}) {
  const candidates = [input.inReplyTo, ...input.references].filter(
    (value): value is string => Boolean(value)
  );

  if (candidates.length === 0) {
    return null;
  }

  return prisma.emailJob.findFirst({
    where: {
      organizationId: input.organizationId,
      messageId: { in: candidates },
      NOT: { origin: "SYSTEM" },
    },
    select: { id: true },
  });
}

// Mirrors the API's attachment filename hardening: strip any path component and
// anything outside a conservative charset, so a hostile sender can't influence
// the storage key or a later Content-Disposition header.
function sanitizeFilename(name: string): string {
  const base = basename(name)
    .replace(/[^\w.\- ]+/g, "_")
    .trim();
  const cleaned = base.length > 0 ? base : "attachment";
  return cleaned.slice(0, 200);
}

/** Keep every MIME part visible, including files that could not be stored. */
export async function storeAttachments(input: {
  organizationId: string;
  inboundMessageId: string;
  mail: ParsedMail;
  assertAlive?: () => void;
  abortSignal?: AbortSignal;
}) {
  const { organizationId, inboundMessageId, mail } = input;
  const existing = await prisma.inboundAttachment.findMany({
    where: { inboundMessageId },
  });
  const claimedLegacy = new Set<string>();
  let pending = false;
  for (const [partIndex, part] of (mail.attachments ?? []).entries()) {
    input.assertAlive?.();
    const filename = sanitizeFilename(
      part.filename ?? part.cid ?? "attachment"
    );
    const contentType = part.contentType || "application/octet-stream";
    const content = part.content;
    const size = content?.length ?? part.size ?? 0;
    // Legacy rows have no MIME index. Adopt only a matching part, once, so an
    // upgrade neither duplicates good files nor mistakes a skipped part for one.
    let row =
      existing.find((file) => file.partIndex === partIndex) ??
      existing.find(
        (file) =>
          file.partIndex === null &&
          !claimedLegacy.has(file.id) &&
          file.filename === filename &&
          file.contentType === contentType &&
          file.size === size &&
          file.contentId === (part.cid ?? null)
      );
    if (row && row.partIndex === null) {
      claimedLegacy.add(row.id);
      await prisma.inboundAttachment.update({
        where: { id: row.id },
        data: { partIndex },
      });
    }
    if (row?.storageStatus === "AVAILABLE") continue;
    const oversized = size > env.INBOUND_ATTACHMENT_MAX_BYTES;
    const storageKey =
      row?.storageKey ??
      `inbound/${organizationId}/${inboundMessageId}/${partIndex}-${filename}`;
    const unavailable = oversized ? "TOO_LARGE" : "UNAVAILABLE";
    const storageError = oversized
      ? `This file exceeds this instance's ${env.INBOUND_ATTACHMENT_MAX_BYTES}-byte attachment limit. Ask an administrator to raise the limit, then retry.`
      : "This file has not finished loading from the mailbox. Retry when the connection is available.";
    if (!row)
      row = await prisma.inboundAttachment.create({
        data: {
          organizationId,
          inboundMessageId,
          partIndex,
          filename,
          contentType,
          size,
          storageKey,
          contentId: part.cid ?? null,
          isInline: part.contentDisposition === "inline",
          storageStatus: unavailable,
          storageError,
        },
      });
    else
      await prisma.inboundAttachment.update({
        where: { id: row.id },
        data: { storageStatus: unavailable, storageError },
      });
    if (oversized) continue;
    if (!content) {
      pending = true;
      continue;
    }
    try {
      await storage.putObject({
        key: storageKey,
        body: content,
        contentType,
        abortSignal: input.abortSignal,
      });
      input.assertAlive?.();
      await prisma.inboundAttachment.update({
        where: { id: row.id },
        data: { storageStatus: "AVAILABLE", storageError: null },
      });
    } catch (error) {
      pending = true;
      logger.warn(
        { inboundMessageId, err: error },
        "inbound attachment remains available for retry"
      );
    }
  }
  input.assertAlive?.();
  await prisma.inboundMessage.updateMany({
    where: { id: inboundMessageId },
    data: { contentImportPending: pending },
  });
}

async function recoverAttachments(
  client: ImapFlow,
  account: SyncedAccount,
  assertAlive: () => void,
  abortSignal: AbortSignal
) {
  const locations = await prisma.inboundMessageLocation.findMany({
    where: {
      inboxFolderId: account.folderId,
      present: true,
      uidValidity: account.uidValidity ?? "",
      message: { contentImportPending: true },
    },
    include: { message: true },
    take: 10,
    orderBy: [
      { message: { contentAttemptedAt: { sort: "asc", nulls: "first" } } },
      { id: "asc" },
    ],
  });
  for (const location of locations) {
    const message = location.message;
    assertAlive();
    await prisma.inboundMessage.updateMany({
      where: { id: message.id },
      data: { contentAttemptedAt: new Date() },
    });
    try {
      const remote = await client.fetchOne(
        location.uid,
        { source: true, envelope: true },
        { uid: true }
      );
      assertAlive();
      if (
        !remote ||
        !remote.source ||
        !matchesRemoteIdentity({
          messageId: message.messageId,
          remoteMessageId: remote.envelope?.messageId,
          accountId: account.id,
          folderId: account.folderId,
          uidValidity: location.uidValidity,
          uid: location.uid,
          contentHash: location.contentHash,
          source: remote.source,
        })
      )
        continue;
      const mail = await simpleParser(remote.source);
      if (message.bodyStatus === "UNAVAILABLE")
        await storeParsedMessage({
          account,
          uid: location.uid,
          mail: { ...mail, messageId: message.messageId },
          flags: remote.flags,
          internalDate: remote.internalDate,
          historical: true,
          assertAlive,
          abortSignal,
        });
      else
        await storeAttachments({
          organizationId: account.organizationId,
          inboundMessageId: message.id,
          mail,
          assertAlive,
          abortSignal,
        });
    } catch (error) {
      assertAlive();
      logger.warn(
        { inboundMessageId: message.id, err: error },
        "inbound attachment recovery will retry"
      );
    }
  }
}

async function storeParsedMessage(input: {
  account: SyncedAccount;
  uid: number;
  flags?: Set<string>;
  internalDate?: Date | string;
  mail: ParsedMail;
  historical?: boolean;
  bodyUnavailable?: boolean;
  assertAlive?: () => void;
  abortSignal?: AbortSignal;
}) {
  const {
    account,
    uid,
    flags,
    internalDate,
    mail,
    historical,
    bodyUnavailable,
  } = input;
  const messageId =
    mail.messageId ??
    `${account.id}:${account.folderId}:${account.uidValidity}:${uid}`;
  input.assertAlive?.();
  if (
    account.folderRole !== "INBOX" &&
    (await prisma.emailJob.findFirst({
      where: {
        organizationId: account.organizationId,
        messageId,
        origin: "SYSTEM",
        ...(account.folderRole === "SENT"
          ? {}
          : {
              NOT: {
                toEmail: {
                  equals: account.email,
                  mode: "insensitive" as const,
                },
              },
            }),
      },
      select: { id: true },
    }))
  )
    return;
  const references = normalizeReferences(mail);
  const outbound = await findOutboundThread({
    organizationId: account.organizationId,
    inReplyTo: mail.inReplyTo,
    references,
  });
  const from = firstAddress(mail.from);
  const receivedAt =
    mail.date ?? (internalDate ? new Date(internalDate) : new Date());
  const seen = flags?.has("\\Seen") ?? false;

  // Bounce reports (DSNs) are still stored as inbound messages — they should
  // be visible — but flagged, and fed into bounce accounting below. The sync
  // account's own address and the daemon sender are excluded so the body-scan
  // fallback can't mistake them for the failed recipient.
  const dsn = parseDsn(mail, {
    excludeAddresses: [account.email, from.email],
  });

  // The upsert makes re-syncing a UID safe; the bounce side effects below must
  // run only when this DSN is first seen, so remember whether the row existed
  // (sync is sequential per account, so read-then-upsert doesn't race).
  const existing = await prisma.inboundMessage.findUnique({
    where: {
      inboxAccountId_messageId: {
        inboxAccountId: account.id,
        messageId,
      },
    },
    select: {
      id: true,
      bodyStatus: true,
      readAt: true,
      readRevision: true,
      readPending: true,
      flagged: true,
      flagRevision: true,
      flagPending: true,
    },
  });
  // Existing logical messages keep their shared state when another folder copy
  // appears. A stale copy becomes pending rather than undoing a teammate action.
  async function storeLocation(
    id: string,
    readAt: Date | null,
    readRevision: number,
    flagged: boolean,
    flagRevision: number
  ) {
    const sameRead = Boolean(readAt) === seen;
    const sameFlag = flagged === (flags?.has("\\Flagged") ?? false);
    const previous = await prisma.inboundMessageLocation.findUnique({
      where: {
        inboxFolderId_uidValidity_uid: {
          inboxFolderId: account.folderId,
          uidValidity: account.uidValidity!,
          uid,
        },
      },
    });
    await prisma.inboundMessageLocation.upsert({
      where: {
        inboxFolderId_uidValidity_uid: {
          inboxFolderId: account.folderId,
          uidValidity: account.uidValidity!,
          uid,
        },
      },
      create: {
        inboundMessageId: id,
        inboxFolderId: account.folderId,
        uidValidity: account.uidValidity!,
        uid,
        remoteSeen: seen,
        remoteFlagged: flags?.has("\\Flagged") ?? false,
        readAppliedRevision: sameRead ? readRevision : 0,
        flagAppliedRevision: sameFlag ? flagRevision : 0,
      },
      update: { inboundMessageId: id, present: true, observedAt: new Date() },
    });
    if (!previous?.present && !sameRead)
      await prisma.inboundMessage.updateMany({
        where: { id, readRevision },
        data: { readPending: true },
      });
    if (!previous?.present && !sameFlag)
      await prisma.inboundMessage.updateMany({
        where: { id, flagRevision },
        data: { flagPending: true },
      });
  }
  if (bodyUnavailable && existing?.bodyStatus === "AVAILABLE") {
    await prisma.inboundMessage.updateMany({
      where: { id: existing.id },
      data: {
        imapUid: uid,
        imapUidValidity: account.uidValidity,
        contentImportPending: true,
      },
    });
    await storeLocation(
      existing.id,
      existing.readAt,
      existing.readRevision,
      existing.flagged,
      existing.flagRevision
    );
    return;
  }

  input.assertAlive?.();
  const stored = await prisma.inboundMessage.upsert({
    where: {
      inboxAccountId_messageId: {
        inboxAccountId: account.id,
        messageId,
      },
    },
    create: {
      organizationId: account.organizationId,
      inboxAccountId: account.id,
      emailJobId: outbound?.id,
      messageId,
      inReplyTo: mail.inReplyTo,
      references,
      fromEmail: from.email,
      fromName: from.name,
      replyTo: addressList(mail.replyTo),
      to: addressList(mail.to),
      cc: addressList(mail.cc),
      subject: mail.subject ?? "",
      text: mail.text,
      html: typeof mail.html === "string" ? mail.html : undefined,
      receivedAt,
      readAt: seen ? receivedAt : undefined,
      flagged: flags?.has("\\Flagged") ?? false,
      imapUid: uid,
      imapUidValidity: account.uidValidity,
      isDsn: Boolean(dsn),
      contentImportPending: true,
      bodyStatus: bodyUnavailable ? "UNAVAILABLE" : "AVAILABLE",
      bodyError: bodyUnavailable
        ? "The mail server did not return this message body. Reload the message to retry."
        : null,
    },
    update: {
      emailJobId: outbound?.id,
      inReplyTo: mail.inReplyTo,
      references,
      fromEmail: from.email,
      fromName: from.name,
      replyTo: addressList(mail.replyTo),
      to: addressList(mail.to),
      cc: addressList(mail.cc),
      subject: mail.subject ?? "",
      text: mail.text,
      html: typeof mail.html === "string" ? mail.html : undefined,
      receivedAt,
      imapUid: uid,
      imapUidValidity: account.uidValidity,
      isDsn: Boolean(dsn),
      contentImportPending: true,
      bodyStatus: bodyUnavailable ? "UNAVAILABLE" : "AVAILABLE",
      bodyError: bodyUnavailable
        ? "The mail server did not return this message body. Reload the message to retry."
        : null,
    },
  });

  await storeLocation(
    stored.id,
    stored.readAt,
    stored.readRevision,
    stored.flagged,
    stored.flagRevision
  );
  if (!bodyUnavailable)
    await storeAttachments({
      organizationId: account.organizationId,
      inboundMessageId: stored.id,
      mail,
      assertAlive: input.assertAlive,
      abortSignal: input.abortSignal,
    });

  // First sighting only: the unique (inboxAccountId, messageId) row is the
  // idempotency key, so a duplicate or re-synced DSN never double-counts a
  // bounce. Failures are contained — a weird DSN must not wedge the mailbox
  // and block every later message.
  if (dsn && !existing && !historical) {
    try {
      await applyDsnBounce({
        organizationId: account.organizationId,
        inboundMessageId: stored.id,
        threadEmailJobId: outbound?.id ?? null,
        dsn,
      });
    } catch (error) {
      logger.error(
        { inboundMessageId: stored.id, err: error },
        "failed to process DSN"
      );
    }
  }

  // Notify only on a genuinely new human message. A DSN is bounce plumbing, a
  // re-synced UID is not news, and a message already flagged \Seen was read in
  // another client — alerting on any of those trains people to ignore the
  // alerts. Push is best-effort: a failure here must never fail the sync.
  if (
    !existing &&
    !dsn &&
    !seen &&
    !historical &&
    !bodyUnavailable &&
    account.folderRole === "INBOX"
  ) {
    try {
      await notifyNewInboundMessage({
        organizationId: account.organizationId,
        inboxAccountId: account.id,
        inboxAccountEmail: account.email,
        messageId: stored.id,
        // Display name alone — the banner reads like a message from a person,
        // the way every mail client shows it. The address is one tap away in
        // the message itself, and `Name <addr@host>` on a narrow banner spends
        // the title on a string nobody reads and truncates the name that
        // matters. Senders with no display name fall back to the address.
        sender: from.name || from.email,
        subject: mail.subject ?? "",
        // One notification per conversation: a burst of replies to the same
        // thread collapses instead of stacking.
        threadKey: outbound?.id ?? stored.id,
        // Who the mail was actually written to, so members on
        // ADDRESSED_TO_ME are only woken for their own.
        recipientEmails: [...addressList(mail.to), ...addressList(mail.cc)],
      });
    } catch (error) {
      logger.warn(
        { inboundMessageId: stored.id, err: error },
        "failed to send inbox push notification"
      );
    }
  }
}

async function getActiveInboxAccounts(id?: string) {
  return prisma.inboxAccount.findMany({
    where: {
      status: "ACTIVE",
      ...(id ? { id } : {}),
    },
  });
}

export async function syncInboxAccount(account: InboxAccount) {
  // Serialize account sync across workers, including scheduler/manual overlap.
  // Bounded imports and flag scans finish within this transaction's lock lease.
  const moreMoves = await prisma.$transaction(
    async (db) => {
      const locks = await db.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${"inbox-sync:" + account.id}, 0)) AS locked`;
      if (!locks[0]?.locked) return;
      // Re-read cursors after acquiring the lock, not from an old scheduler snapshot.
      const current = await prisma.inboxAccount.findFirst({
        where: { id: account.id, status: "ACTIVE" },
      });
      return current ? syncLockedInboxAccount(current) : false;
    },
    { timeout: 600_000 }
  );
  // Redis follow-up dispatch must not extend the account's database lock lease.
  // A worker restart or Redis failure leaves the durable PENDING rows available
  // for the periodic account check.
  if (moreMoves)
    void inboxSyncQueue
      .add(
        "sync-inbox",
        { inboxAccountId: account.id },
        {
          jobId: `inbox-moves-${account.id}-${randomUUID()}`,
          removeOnComplete: true,
          removeOnFail: true,
        }
      )
      .catch(() => undefined);
}

async function syncLockedInboxAccount(account: InboxAccount) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: decryptSecret(account.usernameEncrypted),
      pass: decryptSecret(account.passwordEncrypted),
    },
    logger: false,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });

  const deadline = Date.now() + 240_000;
  const abortSignal = AbortSignal.timeout(240_000);
  const close = () => client.close();
  abortSignal.addEventListener("abort", close, { once: true });
  const assertAlive = () => {
    abortSignal.throwIfAborted();
    if (Date.now() >= deadline)
      throw new Error(
        "Mailbox import time limit reached; its saved cursors will resume on the next check."
      );
  };

  try {
    await client.connect();
    const folders = await discoverFolders(
      client,
      account.id,
      account.mailbox,
      assertAlive
    );
    const moreMoves = await processInboxMoves(client, account.id, assertAlive);
    const primary = folders.find((folder) => folder.path === account.mailbox);
    // Keep daily inbox checks responsive and rotate other folders behind it.
    // Every folder keeps independent cursors; one large folder cannot consume
    // an unbounded body import or restart all other folders on every check.
    const selected = [
      ...(primary ? [primary] : []),
      ...folders.filter((folder) => folder.id !== primary?.id).slice(0, 1),
    ];
    if (!primary)
      await prisma.inboxAccount.update({
        where: { id: account.id },
        data: {
          lastSyncError:
            "The configured folder is no longer on the mail server. Its cached messages are retained.",
        },
      });
    let primaryError: unknown;
    for (const folder of selected) {
      assertAlive();
      try {
        await syncOpenedFolder(
          client,
          {
            ...account,
            mailbox: folder.path,
            folderId: folder.id,
            folderRole: folder.role,
            uidValidity: folder.uidValidity,
            lastSeenUid: folder.lastSeenUid,
            historyBeforeUid: folder.historyBeforeUid,
            flagsCursor: folder.flagsCursor,
          },
          account.mailbox,
          assertAlive,
          abortSignal
        );
      } catch (error) {
        await prisma.inboxFolder.update({
          where: { id: folder.id },
          data: {
            lastSyncedAt: new Date(),
            lastSyncError:
              "Could not check this folder. Its saved history will resume on the next check.",
          },
        });
        if (folder.id === primary?.id) primaryError = error;
        assertAlive();
        logger.warn(
          { inboxFolderId: folder.id, err: error },
          "folder sync will retry"
        );
      }
    }
    if (primaryError) throw primaryError;
    return moreMoves;
  } catch (error) {
    await prisma.inboxAccount.update({
      where: { id: account.id },
      data: {
        lastSyncError:
          "Could not check this mailbox. Ask an administrator to test the connection.",
      },
    });
    throw error;
  } finally {
    abortSignal.removeEventListener("abort", close);
    client.close();
  }
}

async function syncOpenedFolder(
  client: ImapFlow,
  account: SyncedAccount,
  configuredMailbox: string,
  assertAlive: () => void,
  abortSignal: AbortSignal
) {
  let maxSeenUid = account.lastSeenUid ?? 0;
  const mailbox = await client.mailboxOpen(account.mailbox, {
    readOnly: false,
  });
  const uidValidity = mailbox.uidValidity?.toString();
  if (!uidValidity)
    throw new Error("The server did not confirm this folder's UID validity.");
  await prisma.inboundMessageLocation.updateMany({
    where: {
      inboxFolderId: account.folderId,
      uidValidity: { not: uidValidity },
      present: true,
    },
    data: { present: false },
  });
  const reset = Boolean(uidValidity && account.uidValidity !== uidValidity);
  if (reset) maxSeenUid = 0;
  const currentAccount = {
    ...account,
    uidValidity: uidValidity ?? account.uidValidity,
    flagsCursor: reset ? 0 : account.flagsCursor,
  };

  const batch = Math.max(1, Math.min(100, env.INBOX_SYNC_MAX_MESSAGES));
  async function countMatches(query: SearchObject) {
    const result = await client.search(query, {
      uid: true,
      returnOptions: ["COUNT"],
    });
    if (!result)
      throw new Error("The mail server did not confirm its message search.");
    // ImapFlow falls back to UID SEARCH for servers without ESEARCH. Bodies
    // remain bounded even when that compatibility response lists more UIDs.
    if (Array.isArray(result)) return result.length;
    if (typeof result.count !== "number")
      throw new Error("The mail server did not return a message count.");
    return result.count;
  }
  async function uidWindow(
    first: number,
    last: number,
    accepts: (uid: number) => boolean
  ) {
    const uids: number[] = [];
    if (first > last) return uids;
    for await (const message of client.fetch(`${first}:${last}`, {
      uid: true,
    }))
      if (accepts(message.uid)) uids.push(message.uid);
    return uids.sort((a, b) => a - b);
  }
  async function importUids(uids: number[], historical: boolean) {
    if (!uids.length) return;
    for await (const message of client.fetch(
      uids,
      {
        uid: true,
        flags: true,
        internalDate: true,
        source: true,
        envelope: true,
      },
      { uid: true }
    )) {
      const envelope = message.envelope;
      const mail: ParsedMail = message.source
        ? await simpleParser(message.source)
        : {
            headers: new Map(),
            headerLines: [],
            html: false,
            attachments: [],
            messageId: envelope?.messageId,
            subject: envelope?.subject,
            date: envelope?.date,
            from: {
              value: (envelope?.from ?? []).map((entry) => ({
                ...entry,
                name: entry.name ?? "",
              })),
              html: "",
              text: "",
            },
            to: {
              value: (envelope?.to ?? []).map((entry) => ({
                ...entry,
                name: entry.name ?? "",
              })),
              html: "",
              text: "",
            },
            cc: {
              value: (envelope?.cc ?? []).map((entry) => ({
                ...entry,
                name: entry.name ?? "",
              })),
              html: "",
              text: "",
            },
          };
      if (!mail.messageId) {
        const known = await prisma.inboundMessageLocation.findUnique({
          where: {
            inboxFolderId_uidValidity_uid: {
              inboxFolderId: account.folderId,
              uidValidity,
              uid: message.uid,
            },
          },
          include: { message: { select: { messageId: true } } },
        });
        if (
          known &&
          ((!message.source && !envelope?.messageId) ||
            matchesRemoteIdentity({
              messageId: known.message.messageId,
              remoteMessageId: envelope?.messageId,
              accountId: account.id,
              folderId: account.folderId,
              uidValidity,
              uid: message.uid,
              contentHash: known.contentHash,
              source: message.source,
            }))
        )
          mail.messageId = known.message.messageId;
      }
      await storeParsedMessage({
        account: currentAccount,
        uid: message.uid,
        flags: message.flags,
        internalDate: message.internalDate,
        mail,
        historical,
        bodyUnavailable: !message.source,
        assertAlive,
        abortSignal,
      });
    }
  }
  let historyBeforeUid = account.historyBeforeUid ?? 0;
  const initial = reset || !account.lastSeenUid;
  if (!mailbox.exists) historyBeforeUid = 0;
  else if (initial) {
    const uids = await uidWindow(
      Math.max(1, mailbox.exists - batch + 1),
      mailbox.exists,
      () => true
    );
    await importUids(uids, account.folderRole !== "INBOX");
    maxSeenUid = Math.max(mailbox.uidNext - 1, uids.at(-1) ?? 0);
    historyBeforeUid = uids.length ? uids[0] - 1 : 0;
  } else if (account.lastSeenUid! + 1 < mailbox.uidNext) {
    const count = await countMatches({
      uid: `${account.lastSeenUid! + 1}:*`,
    });
    if (count) {
      const first = Math.max(1, mailbox.exists - count + 1);
      const uids = await uidWindow(
        first,
        Math.min(mailbox.exists, first + batch - 1),
        (uid) => uid > account.lastSeenUid!
      );
      await importUids(uids, account.folderRole !== "INBOX");
      if (uids.length)
        maxSeenUid =
          count <= batch
            ? Math.max(mailbox.uidNext - 1, uids.at(-1)!)
            : uids.at(-1)!;
    } else maxSeenUid = mailbox.uidNext - 1;
  }
  // Put durable teammate actions ahead of older bodies and file recovery.
  for (let round = 0; round < 3; round++)
    if (
      !(await synchronizeReadState(client, {
        id: account.folderId,
        inboxAccountId: account.id,
        uidValidity,
        flagsCursor: currentAccount.flagsCursor,
      }))
    )
      break;
  if (!initial && historyBeforeUid > 0 && mailbox.exists) {
    const count = await countMatches({ uid: `1:${historyBeforeUid}` });
    if (!count) historyBeforeUid = 0;
    else {
      const uids = await uidWindow(
        Math.max(1, count - batch + 1),
        count,
        (uid) => uid <= historyBeforeUid
      );
      await importUids(uids, true);
      if (uids.length) historyBeforeUid = uids[0] - 1;
    }
  }

  await recoverAttachments(client, currentAccount, assertAlive, abortSignal);

  for (let round = 0; round < 3; round++) {
    if (
      !(await synchronizeReadState(client, {
        id: account.folderId,
        inboxAccountId: account.id,
        uidValidity,
        flagsCursor: currentAccount.flagsCursor,
      }))
    )
      break;
  }

  assertAlive();
  await prisma.inboxFolder.update({
    where: { id: account.folderId },
    data: {
      lastSyncedAt: new Date(),
      historyBeforeUid,
      lastSeenUid: reset ? maxSeenUid : maxSeenUid || account.lastSeenUid,
      uidValidity,
      lastSyncError: null,
    },
  });
  if (account.mailbox === configuredMailbox)
    await prisma.inboxAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        lastSeenUid: maxSeenUid,
        uidValidity,
        historyBeforeUid,
        lastSyncError: null,
      },
    });
}

export async function syncInboxAccounts(inboxAccountId?: string) {
  const accounts = await getActiveInboxAccounts(inboxAccountId);
  for (const account of accounts) {
    try {
      await syncInboxAccount(account);
    } catch (error) {
      logger.error(
        { inboxAccountId: account.id, err: error },
        "mailbox sync failed"
      );
      if (inboxAccountId) throw error;
    }
  }
}
