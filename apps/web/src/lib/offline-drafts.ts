import { ApiError, api, type EmailDraft } from "./api.js";

/**
 * Composer drafts that haven't reached the server yet.
 *
 * The composer already auto-saves every two seconds, but that save is a network
 * call: on a phone that walks into a lift, it fails silently and the message
 * only exists in React state until the tab is closed. This is the local half of
 * that promise — every auto-save writes here first, and the record is deleted
 * only once the server has acknowledged it.
 *
 * IndexedDB rather than localStorage because a draft carries a full HTML body,
 * which is comfortably past the 5 MB localStorage ceiling once a few images are
 * inlined, and because localStorage writes are synchronous and would jank the
 * editor on every keystroke-debounce.
 *
 * Hand-rolled rather than a wrapper library: this is one object store with four
 * operations, and a dependency shipped to every browser session should earn
 * more than that.
 */

const DB_NAME = "qqueue";
const DB_VERSION = 1;
const STORE = "pending-drafts";

/**
 * The composer payload, matching what `api.createEmailDraft` accepts.
 *
 * A `type` rather than an `interface` on purpose: the draft endpoints take
 * `Record<string, unknown>`, and only a type alias picks up the implicit index
 * signature that makes it assignable to one.
 */
export type PendingDraftPayload = {
  subject: string;
  html: string;
  to: string[];
  cc: string[];
  bcc: string[];
  listIds: string[];
  smtpConnectionId?: string;
  templateId?: string;
};

export interface PendingDraft {
  /**
   * Stable across the life of one composed message, and generated on the
   * client. The server id can't be the key: a draft written while offline has
   * never been to the server and so doesn't have one yet.
   */
  localId: string;
  organizationId: string;
  /** The server draft this updates, or null if the server hasn't seen it. */
  draftId: string | null;
  payload: PendingDraftPayload;
  /** When the composer last touched it, for last-write-wins on flush. */
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Private browsing in Firefox and a handful of locked-down enterprise
    // profiles reject the open outright; callers treat that as "no local
    // backup available" rather than as an error worth showing anyone.
    request.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      })
  );
}

/**
 * Every one of these swallows its failure.
 *
 * Local persistence is a safety net under the real save, and a net that tears
 * must not take down the thing it was there to catch — a composer that throws
 * because IndexedDB is unavailable is strictly worse than one that quietly has
 * no offline backup.
 */
export async function savePendingDraft(draft: PendingDraft): Promise<void> {
  try {
    await run("readwrite", (store) => store.put(draft));
  } catch {
    // No local backup this time; the network save still stands on its own.
  }
}

export async function deletePendingDraft(localId: string): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(localId));
  } catch {
    // Worst case the record is replayed once more and updates the same draft.
  }
}

export async function listPendingDrafts(
  organizationId?: string
): Promise<PendingDraft[]> {
  try {
    const all = await run<PendingDraft[]>("readonly", (store) =>
      store.getAll()
    );
    return organizationId
      ? all.filter((draft) => draft.organizationId === organizationId)
      : all;
  } catch {
    return [];
  }
}

/**
 * Push every locally-held draft to the server, oldest first.
 *
 * Called on reconnect and on app start — start matters as much as reconnect,
 * because the common shape of this is not "the network came back while I
 * watched" but "the tab was killed on the Tube and reopened at the office".
 *
 * Returns the drafts that made it, so a mounted composer can adopt the server
 * id its local record was just given.
 */
export async function flushPendingDrafts(
  organizationId?: string
): Promise<Array<{ localId: string; draft: EmailDraft }>> {
  const pending = await listPendingDrafts(organizationId);
  pending.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  const synced: Array<{ localId: string; draft: EmailDraft }> = [];

  for (const record of pending) {
    try {
      const draft = record.draftId
        ? await api.updateEmailDraft(record.draftId, record.payload)
        : await api.createEmailDraft({
            organizationId: record.organizationId,
            ...record.payload,
          });
      await deletePendingDraft(record.localId);
      synced.push({ localId: record.localId, draft });
    } catch (error) {
      /*
        Still unreachable — stop. Every remaining record will fail the same
        way, and walking the whole queue to collect identical failures wastes a
        phone's radio. They keep for the next attempt.
      */
      if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
        break;
      }

      /*
        The server refused this one specifically: the draft it referenced was
        deleted from another device, the membership was revoked, the payload no
        longer validates. Replaying it would fail identically forever and wedge
        every draft queued behind it, so it is dropped rather than allowed to
        block the queue.
      */
      await deletePendingDraft(record.localId);
    }
  }

  return synced;
}

/**
 * Wire the queue to the browser's connectivity events, once, at app start.
 *
 * Lives outside React so a draft written on the compose screen still syncs
 * after the user has navigated to the inbox and the composer has unmounted.
 */
export function startDraftSync(): void {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  const flush = () => {
    void flushPendingDrafts();
  };

  window.addEventListener("online", flush);
  // Coming back to a backgrounded tab is the other moment connectivity tends to
  // have quietly returned without an `online` event ever firing.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      flush();
    }
  });

  if (navigator.onLine) {
    flush();
  }
}
