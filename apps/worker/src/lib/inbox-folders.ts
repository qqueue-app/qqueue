import type { ImapFlow, ListResponse } from "imapflow";
import { prisma } from "./prisma.js";

export function folderRole(folder: Pick<ListResponse, "path" | "specialUse">) {
  if (folder.path.toUpperCase() === "INBOX") return "INBOX";
  const roles: Record<string, string> = {
    "\\Sent": "SENT",
    "\\Drafts": "DRAFTS",
    "\\Archive": "ARCHIVE",
    "\\Trash": "TRASH",
    "\\Junk": "JUNK",
    "\\All": "ALL",
  };
  return roles[folder.specialUse ?? ""] ?? "OTHER";
}

/** Publish disappearance only after a complete, successful LIST response. */
export async function discoverFolders(
  client: ImapFlow,
  accountId: string,
  primaryPath: string,
  assertAlive?: () => void
) {
  const listed = await client.list();
  const selectable = listed.filter((folder) => !folder.flags.has("\\Noselect"));
  return prisma.$transaction(
    async (db) => {
      for (const folder of selectable) {
        assertAlive?.();
        const metadata = {
          name: folder.name || folder.path,
          role: folderRole(folder),
          specialUse: folder.specialUse ?? null,
          present: true,
          isPrimary: folder.path === primaryPath,
        };
        await db.inboxFolder.upsert({
          where: {
            inboxAccountId_path: {
              inboxAccountId: accountId,
              path: folder.path,
            },
          },
          create: { inboxAccountId: accountId, path: folder.path, ...metadata },
          update: metadata,
        });
      }
      await db.inboxFolder.updateMany({
        where: {
          inboxAccountId: accountId,
          path: { notIn: selectable.map((folder) => folder.path) },
        },
        data: { present: false },
      });
      return db.inboxFolder.findMany({
        where: { inboxAccountId: accountId, present: true },
        orderBy: [
          { lastSyncedAt: { sort: "asc", nulls: "first" } },
          { path: "asc" },
        ],
      });
    },
    { timeout: 60_000 }
  );
}

export function matchesRemoteIdentity(input: {
  messageId: string;
  remoteMessageId?: string;
  accountId: string;
  folderId: string;
  uidValidity: string;
  uid: number;
}) {
  if (input.remoteMessageId) return input.remoteMessageId === input.messageId;
  return [
    `${input.accountId}:${input.folderId}:${input.uidValidity}:${input.uid}`,
    `${input.accountId}:${input.uidValidity}:${input.uid}`,
    `${input.accountId}:${input.uid}`,
  ].includes(input.messageId);
}
