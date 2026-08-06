import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { ImapFlow } from "imapflow";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { env } from "../config/env.js";
import { decryptSecret } from "./crypto.js";
import { applyDsnBounce, parseDsn } from "./dsn.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import { sendPushToOrganization, truncateForNotification } from "./push.js";
import { storage } from "./storage.js";

type InboxAccount = Awaited<ReturnType<typeof getActiveInboxAccounts>>[number];

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
    },
    select: { id: true },
  });
}

// Mirrors the API's attachment filename hardening: strip any path component and
// anything outside a conservative charset, so a hostile sender can't influence
// the storage key or a later Content-Disposition header.
function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[^\w.\- ]+/g, "_").trim();
  const cleaned = base.length > 0 ? base : "attachment";
  return cleaned.slice(0, 200);
}

/**
 * Persist a received message's attachments: blob to object storage, metadata to
 * Postgres. Runs after the message row exists so rows can hang off its id.
 *
 * Replaces any existing rows for the message rather than adding to them —
 * storeParsedMessage upserts, so a re-sync of the same UID must not accumulate
 * duplicate attachments.
 *
 * Oversized parts are skipped rather than failing the whole sync: one 200MB
 * attachment must not wedge a mailbox and block every later message.
 */
async function storeAttachments(input: {
  organizationId: string;
  inboundMessageId: string;
  mail: ParsedMail;
}) {
  const { organizationId, inboundMessageId, mail } = input;
  const parts = mail.attachments ?? [];

  const existing = await prisma.inboundAttachment.findMany({
    where: { inboundMessageId },
    select: { id: true }
  });
  if (existing.length > 0) {
    return;
  }
  if (parts.length === 0) {
    return;
  }

  for (const part of parts) {
    const content = part.content;
    if (!content || content.length === 0) {
      continue;
    }
    if (content.length > env.INBOUND_ATTACHMENT_MAX_BYTES) {
      logger.warn(
        { inboundMessageId, bytes: content.length },
        "skipping oversized inbound attachment"
      );
      continue;
    }

    const filename = sanitizeFilename(
      part.filename ?? part.cid ?? "attachment"
    );
    const storageKey = `inbound/${organizationId}/${randomUUID()}-${filename}`;

    try {
      await storage.putObject({
        key: storageKey,
        body: content,
        contentType: part.contentType || "application/octet-stream"
      });
    } catch (error) {
      // Storage is best-effort here; losing one blob shouldn't cost us the
      // message body we already stored.
      logger.error(
        { inboundMessageId, err: error },
        "failed to store inbound attachment"
      );
      continue;
    }

    await prisma.inboundAttachment.create({
      data: {
        organizationId,
        inboundMessageId,
        filename,
        contentType: part.contentType || "application/octet-stream",
        size: content.length,
        storageKey,
        contentId: part.cid ?? null,
        // mailparser reports "inline" for parts the sender meant to render
        // (usually cid: images) rather than list as downloads.
        isInline: part.contentDisposition === "inline"
      }
    });
  }
}

async function storeParsedMessage(input: {
  account: InboxAccount;
  uid: number;
  flags?: Set<string>;
  internalDate?: Date | string;
  mail: ParsedMail;
}) {
  const { account, uid, flags, internalDate, mail } = input;
  const messageId = mail.messageId ?? `${account.id}:${uid}`;
  const references = normalizeReferences(mail);
  const outbound = await findOutboundThread({
    organizationId: account.organizationId,
    inReplyTo: mail.inReplyTo,
    references,
  });
  const from = firstAddress(mail.from);
  const receivedAt = mail.date ?? (internalDate ? new Date(internalDate) : new Date());
  const seen = flags?.has("\\Seen") ?? false;

  // Bounce reports (DSNs) are still stored as inbound messages — they should
  // be visible — but flagged, and fed into bounce accounting below. The sync
  // account's own address and the daemon sender are excluded so the body-scan
  // fallback can't mistake them for the failed recipient.
  const dsn = parseDsn(mail, {
    excludeAddresses: [account.email, from.email]
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
    select: { id: true },
  });

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
      to: addressList(mail.to),
      cc: addressList(mail.cc),
      subject: mail.subject ?? "",
      text: mail.text,
      html: typeof mail.html === "string" ? mail.html : undefined,
      receivedAt,
      readAt: seen ? receivedAt : undefined,
      imapUid: uid,
      isDsn: Boolean(dsn),
    },
    update: {
      emailJobId: outbound?.id,
      inReplyTo: mail.inReplyTo,
      references,
      fromEmail: from.email,
      fromName: from.name,
      to: addressList(mail.to),
      cc: addressList(mail.cc),
      subject: mail.subject ?? "",
      text: mail.text,
      html: typeof mail.html === "string" ? mail.html : undefined,
      receivedAt,
      readAt: seen ? receivedAt : undefined,
      imapUid: uid,
      isDsn: Boolean(dsn),
    },
  });

  await storeAttachments({
    organizationId: account.organizationId,
    inboundMessageId: stored.id,
    mail,
  });

  // First sighting only: the unique (inboxAccountId, messageId) row is the
  // idempotency key, so a duplicate or re-synced DSN never double-counts a
  // bounce. Failures are contained — a weird DSN must not wedge the mailbox
  // and block every later message.
  if (dsn && !existing) {
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
  if (!existing && !dsn && !seen) {
    try {
      await sendPushToOrganization({
        organizationId: account.organizationId,
        payload: {
          title: from.name
            ? `${from.name} <${from.email}>`
            : from.email,
          body: truncateForNotification(mail.subject || "(no subject)"),
          url: `/inbox?message=${stored.id}`,
          // One notification per conversation: a burst of replies to the same
          // thread collapses instead of stacking.
          tag: `inbox:${outbound?.id ?? stored.id}`,
        },
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
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: decryptSecret(account.usernameEncrypted),
      pass: decryptSecret(account.passwordEncrypted),
    },
    logger: false,
  });

  let maxSeenUid = account.lastSeenUid ?? 0;

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(account.mailbox, {
      readOnly: true,
    });

    const startUid =
      account.lastSeenUid && account.lastSeenUid > 0
        ? account.lastSeenUid + 1
        : Math.max(1, mailbox.uidNext - env.INBOX_SYNC_MAX_MESSAGES);

    if (mailbox.exists > 0 && startUid < mailbox.uidNext) {
      for await (const message of client.fetch(
        `${startUid}:*`,
        {
          uid: true,
          flags: true,
          internalDate: true,
          source: true,
        },
        { uid: true }
      )) {
        if (!message.source) {
          continue;
        }

        const mail = await simpleParser(message.source);
        await storeParsedMessage({
          account,
          uid: message.uid,
          flags: message.flags,
          internalDate: message.internalDate,
          mail,
        });
        maxSeenUid = Math.max(maxSeenUid, message.uid);
      }
    }

    await prisma.inboxAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        lastSeenUid: maxSeenUid || account.lastSeenUid,
      },
    });
  } finally {
    client.close();
  }
}

export async function syncInboxAccounts(inboxAccountId?: string) {
  const accounts = await getActiveInboxAccounts(inboxAccountId);
  for (const account of accounts) {
    await syncInboxAccount(account);
  }
}
