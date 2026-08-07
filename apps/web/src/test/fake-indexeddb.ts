import { vi } from "vitest";

/**
 * The smallest IndexedDB that `lib/offline-drafts.ts` actually uses.
 *
 * jsdom implements no IndexedDB at all, and without one the draft queue's tests
 * would only ever exercise its failure paths — which swallow everything, so
 * they would pass no matter how broken the real path was. That is worse than no
 * test.
 *
 * A hand-written fake rather than a dependency: the surface in use here is one
 * object store and four operations (put/get/getAll/delete), and it is exercised
 * through the module's public functions, so this only has to be faithful about
 * the request/transaction callback shape — not about durability, versioning,
 * cursors or key ranges.
 */

interface FakeRequest<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

/** Resolve a request on a macrotask, the way a real one settles later. */
function settle<T>(request: FakeRequest<T>, result: T) {
  request.result = result;
  setTimeout(() => request.onsuccess?.(), 0);
  return request;
}

export interface FakeIndexedDB {
  /** The rows currently held, keyed by the store's keyPath value. */
  rows: Map<string, unknown>;
  /** Make the next `open()` fail, standing in for private browsing. */
  failNextOpen: () => void;
  restore: () => void;
}

export function installFakeIndexedDB(): FakeIndexedDB {
  const rows = new Map<string, unknown>();
  let openFails = false;

  function makeStore() {
    return {
      put(value: Record<string, unknown>) {
        const request = blankRequest<undefined>();
        rows.set(String(value.localId), value);
        return settle(request, undefined);
      },
      delete(key: string) {
        const request = blankRequest<undefined>();
        rows.delete(key);
        return settle(request, undefined);
      },
      getAll() {
        const request = blankRequest<unknown[]>();
        return settle(request, [...rows.values()]);
      },
      get(key: string) {
        const request = blankRequest<unknown>();
        return settle(request, rows.get(key));
      },
    };
  }

  function blankRequest<T>(): FakeRequest<T> {
    return {
      result: undefined as T,
      error: null,
      onsuccess: null,
      onerror: null,
    };
  }

  const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB;

  const factory = {
    open() {
      const request = blankRequest<unknown>();
      request.onupgradeneeded = null;
      request.onblocked = null;

      setTimeout(() => {
        if (openFails) {
          openFails = false;
          request.error = new Error("blocked");
          request.onerror?.();
          return;
        }
        request.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => makeStore(),
          transaction: () => {
            const tx = {
              objectStore: () => makeStore(),
              oncomplete: null as (() => void) | null,
            };
            // Real transactions complete after their requests do; the module
            // closes the database from this callback.
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
          },
          close: vi.fn(),
        };
        request.onsuccess?.();
      }, 0);

      return request;
    },
  };

  (globalThis as { indexedDB?: unknown }).indexedDB = factory;

  return {
    rows,
    failNextOpen: () => {
      openFails = true;
    },
    restore: () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = original;
    },
  };
}
