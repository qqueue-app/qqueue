/** Reuse the same device backup when a saved reply is reopened through its
 * message instead of its Drafts deep link. Never mix two explicit draft IDs. */
export function replyBackupKey(
  userId: string,
  organizationId: string,
  messageId: string,
  draftId?: string
) {
  const base = `qqueue.reply.${userId}.${organizationId}.${messageId}`;
  const candidates = listReplyBackups(
    userId,
    organizationId,
    messageId,
    draftId
  );
  return candidates[0]?.key ?? (draftId ? `${base}.${draftId}` : base);
}

export interface StoredReplyBackup {
  key: string;
  value: {
    html: string;
    updatedAt?: string;
    draftId?: string;
    revision?: number;
    clientId?: string;
    [key: string]: unknown;
  };
}
export function listReplyBackups(
  userId: string,
  organizationId: string,
  messageId: string,
  draftId?: string
): StoredReplyBackup[] {
  const base = `qqueue.reply.${userId}.${organizationId}.${messageId}`;
  const candidates: StoredReplyBackup[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || (key !== base && !key.startsWith(`${base}.`))) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        if (typeof value?.html !== "string") continue;
        if (
          draftId &&
          value.draftId !== draftId &&
          key !== `${base}.${draftId}`
        )
          continue;
        candidates.push({ key, value });
      } catch {
        /* Retain another readable version when one backup is damaged. */
      }
    }
  } catch {
    return [];
  }
  candidates.sort(
    (a, b) =>
      (Date.parse(b.value.updatedAt ?? "") || 0) -
        (Date.parse(a.value.updatedAt ?? "") || 0) ||
      (a.key === base ? -1 : b.key === base ? 1 : a.key.localeCompare(b.key))
  );
  return candidates;
}
