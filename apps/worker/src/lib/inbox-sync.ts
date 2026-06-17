import { ImapFlow } from "imapflow";
import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { env } from "../config/env.js";
import { decryptSecret } from "./crypto.js";
import { prisma } from "./prisma.js";

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

  await prisma.inboundMessage.upsert({
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
    },
  });
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
