import type { PendingDraft } from "./offline-drafts.js";

// A last-resort safety net for SPA navigation. Never described as durable: it
// disappears when this window closes and beforeunload must warn while it is used.
const copies = new Map<string, PendingDraft>();
const failed = new Set<string>();
const subscribers = new Set<() => void>();
let guarded = false;
function changed() {
  queueMicrotask(() => {
    for (const listener of subscribers) listener();
  });
}
export function warnBeforeClosing(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
function guardWindow() {
  if (guarded || typeof window === "undefined") return;
  guarded = true;
  window.addEventListener("beforeunload", (event) => {
    if (copies.size) warnBeforeClosing(event);
  });
}
export function markWindowDraftVolatile(ticket: PendingDraft) {
  if (isCurrentWindowDraft(ticket)) {
    failed.add(ticket.localId);
    changed();
  }
}
export function subscribeWindowDrafts(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
export function windowDraftCount(userId: string) {
  return [...copies.values()].filter(
    (copy) => copy.userId === userId && failed.has(copy.localId)
  ).length;
}
function raw(snapshot: PendingDraft): PendingDraft {
  const draft = { ...snapshot };
  delete draft.memoryOnly;
  return draft;
}
export function retainWindowDraft(snapshot: PendingDraft) {
  const ticket = raw(snapshot);
  copies.set(ticket.localId, ticket);
  guardWindow();
  changed();
  return ticket;
}
export function isCurrentWindowDraft(ticket: PendingDraft) {
  return copies.get(ticket.localId) === ticket;
}
export function releaseWindowDraft(ticket: PendingDraft) {
  if (isCurrentWindowDraft(ticket)) {
    copies.delete(ticket.localId);
    failed.delete(ticket.localId);
    changed();
  }
}
export function forgetWindowDraft(localId: string) {
  copies.delete(localId);
  failed.delete(localId);
  changed();
}
export function listWindowDrafts(userId: string, organizationId?: string) {
  return [...copies.values()]
    .filter(
      (draft) =>
        draft.userId === userId &&
        (!organizationId || draft.organizationId === organizationId)
    )
    .map((draft) => ({ ...draft, memoryOnly: true }));
}
export function acknowledgeWindowDraft(
  snapshot: PendingDraft,
  serverId: string,
  revision?: number
) {
  const current = copies.get(snapshot.localId);
  if (
    !current ||
    current.userId !== snapshot.userId ||
    current.organizationId !== snapshot.organizationId
  )
    return;
  if (
    !current.pendingUploads?.length &&
    JSON.stringify(current) === JSON.stringify(raw(snapshot))
  ) {
    copies.delete(snapshot.localId);
    failed.delete(snapshot.localId);
  } else if (current.draftId === snapshot.draftId)
    copies.set(snapshot.localId, {
      ...current,
      draftId: serverId,
      revision:
        current.revision === undefined && revision === undefined
          ? undefined
          : Math.max(current.revision ?? 1, revision ?? 1),
    });
  changed();
}
export function withoutWindowMarker(snapshot: PendingDraft) {
  return raw(snapshot);
}

/** Retry only the exact copies still owned by this window; never reinsert an
 * older snapshot after another editor has changed it during a previous write. */
export async function retryWindowDrafts(
  userId: string,
  persist: (copy: PendingDraft) => Promise<boolean>
) {
  for (const ticket of [...copies.values()]) {
    if (ticket.userId === userId && isCurrentWindowDraft(ticket))
      await persist(ticket);
  }
}
