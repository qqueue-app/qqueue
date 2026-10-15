/** Reuse the same device backup when a saved reply is reopened through its
 * message instead of its Drafts deep link. Never mix two explicit draft IDs. */
export function replyBackupKey(
  userId: string,
  organizationId: string,
  messageId: string,
  draftId?: string
) {
  const base = `qqueue.reply.${userId}.${organizationId}.${messageId}`;
  try {
    const baseValue = localStorage.getItem(base);
    if (draftId) {
      const exact = `${base}.${draftId}`;
      if (localStorage.getItem(exact)) return exact;
      if (baseValue && JSON.parse(baseValue).draftId === draftId) return base;
      return exact;
    }
    const candidates: { key: string; at: number }[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || (key !== base && !key.startsWith(`${base}.`))) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        if (typeof value?.html !== "string") continue;
        candidates.push({ key, at: Date.parse(value.updatedAt ?? "") || 0 });
      } catch {
        /* A damaged backup cannot hide another readable version. */
      }
    }
    candidates.sort(
      (a, b) =>
        b.at - a.at ||
        (a.key === base ? -1 : b.key === base ? 1 : a.key.localeCompare(b.key))
    );
    return candidates[0]?.key ?? base;
  } catch {
    return draftId ? `${base}.${draftId}` : base;
  }
}
