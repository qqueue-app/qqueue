import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeIndexedDB, type FakeIndexedDB } from "../test/fake-indexeddb.js";
import { ApiError, api } from "./api.js";
import {
  deletePendingDraft,
  flushPendingDrafts,
  listPendingDrafts,
  savePendingDraft,
  type PendingDraft,
} from "./offline-drafts.js";

function draft(overrides: Partial<PendingDraft> = {}): PendingDraft {
  return {
    localId: "local-1",
    organizationId: "org-1",
    draftId: null,
    payload: {
      subject: "Hello",
      html: "<p>Hi</p>",
      to: ["a@example.com"],
      cc: [],
      bcc: [],
      listIds: [],
    },
    updatedAt: "2026-08-07T10:00:00.000Z",
    ...overrides,
  };
}

describe("offline drafts (§5)", () => {
  let db: FakeIndexedDB;

  beforeEach(() => {
    db = installFakeIndexedDB();
  });

  afterEach(() => {
    db.restore();
    vi.restoreAllMocks();
  });

  it("keeps a draft the server never received", async () => {
    await savePendingDraft(draft());
    const pending = await listPendingDrafts("org-1");
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.subject).toBe("Hello");
  });

  it("keeps organizations apart", async () => {
    await savePendingDraft(draft());
    await savePendingDraft(
      draft({ localId: "local-2", organizationId: "org-2" })
    );

    expect(await listPendingDrafts("org-1")).toHaveLength(1);
    expect(await listPendingDrafts("org-2")).toHaveLength(1);
    expect(await listPendingDrafts()).toHaveLength(2);
  });

  it("creates the draft on the server when it flushes, then forgets it locally", async () => {
    const create = vi
      .spyOn(api, "createEmailDraft")
      .mockResolvedValue({ id: "server-1", updatedAt: "x" } as never);

    await savePendingDraft(draft());
    const synced = await flushPendingDrafts("org-1");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", subject: "Hello" })
    );
    expect(synced).toEqual([
      { localId: "local-1", draft: { id: "server-1", updatedAt: "x" } },
    ]);
    // The server has it now; holding a second copy would resurrect it later.
    expect(await listPendingDrafts()).toHaveLength(0);
  });

  it("updates rather than duplicates when the draft already has a server id", async () => {
    const update = vi
      .spyOn(api, "updateEmailDraft")
      .mockResolvedValue({ id: "server-9", updatedAt: "x" } as never);
    const create = vi.spyOn(api, "createEmailDraft");

    await savePendingDraft(draft({ draftId: "server-9" }));
    await flushPendingDrafts();

    expect(update).toHaveBeenCalledWith("server-9", expect.anything());
    expect(create).not.toHaveBeenCalled();
  });

  it("flushes oldest first, so the newest edit is the one that lands last", async () => {
    const seen: string[] = [];
    vi.spyOn(api, "createEmailDraft").mockImplementation(
      (async (input: { subject: string }) => {
        seen.push(input.subject);
        return { id: "s", updatedAt: "x" };
      }) as never
    );

    await savePendingDraft(
      draft({
        localId: "b",
        updatedAt: "2026-08-07T12:00:00.000Z",
        payload: { ...draft().payload, subject: "newer" },
      })
    );
    await savePendingDraft(
      draft({
        localId: "a",
        updatedAt: "2026-08-07T09:00:00.000Z",
        payload: { ...draft().payload, subject: "older" },
      })
    );

    await flushPendingDrafts();
    expect(seen).toEqual(["older", "newer"]);
  });

  it("stops at the first unreachable server and keeps everything for the retry", async () => {
    vi.spyOn(api, "createEmailDraft").mockRejectedValue(
      new ApiError("Cannot reach the API. Is the server running?", 0)
    );

    await savePendingDraft(draft());
    await savePendingDraft(draft({ localId: "local-2" }));

    expect(await flushPendingDrafts()).toEqual([]);
    // Nothing lost — this is a deferral, which is the whole point.
    expect(await listPendingDrafts()).toHaveLength(2);
  });

  it("drops a draft the server refuses, so it can't wedge the queue behind it", async () => {
    vi.spyOn(api, "createEmailDraft")
      .mockRejectedValueOnce(new ApiError("Draft no longer exists", 404))
      .mockResolvedValueOnce({ id: "server-2", updatedAt: "x" } as never);

    await savePendingDraft(draft({ localId: "doomed", updatedAt: "2026-08-07T09:00:00.000Z" }));
    await savePendingDraft(draft({ localId: "fine", updatedAt: "2026-08-07T10:00:00.000Z" }));

    const synced = await flushPendingDrafts();

    // The rejected one is gone and the one behind it still got through — a 404
    // replayed forever would have blocked it on every future attempt.
    expect(synced.map((entry) => entry.localId)).toEqual(["fine"]);
    expect(await listPendingDrafts()).toHaveLength(0);
  });

  it("deletes a draft by its local key", async () => {
    await savePendingDraft(draft());
    await deletePendingDraft("local-1");
    expect(await listPendingDrafts()).toHaveLength(0);
  });

  it("degrades to no local backup rather than throwing when IndexedDB is unavailable", async () => {
    db.failNextOpen();
    // Private browsing rejects the open outright. A composer that threw here
    // would lose the message it was trying to protect.
    await expect(savePendingDraft(draft())).resolves.toBeUndefined();

    db.failNextOpen();
    await expect(listPendingDrafts()).resolves.toEqual([]);
  });
});
