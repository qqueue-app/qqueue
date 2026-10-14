import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installFakeIndexedDB,
  type FakeIndexedDB,
} from "../test/fake-indexeddb.js";
import { ApiError, api } from "./api.js";
import {
  acknowledgePendingDraft,
  deletePendingDraft,
  flushPendingDrafts,
  listPendingDrafts,
  savePendingDraft,
  type PendingDraft,
} from "./offline-drafts.js";

function draft(overrides: Partial<PendingDraft> = {}): PendingDraft {
  return {
    userId: "user-1",
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
    localStorage.setItem(
      "qqueue.session",
      JSON.stringify({ user: { id: "user-1" }, organizations: [] })
    );
    db = installFakeIndexedDB();
  });

  afterEach(() => {
    db.restore();
    localStorage.removeItem("qqueue.session");
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

  it("never restores or uploads another person's drafts on a shared browser", async () => {
    await savePendingDraft(draft());
    localStorage.setItem(
      "qqueue.session",
      JSON.stringify({ user: { id: "other-user" }, organizations: [] })
    );
    const create = vi.spyOn(api, "createEmailDraft");
    expect(await listPendingDrafts("org-1")).toEqual([]);
    expect(await flushPendingDrafts()).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("retains drafts when the session expires instead of deleting them", async () => {
    vi.spyOn(api, "createEmailDraft").mockRejectedValue(
      new ApiError("Sign in again", 401)
    );
    await savePendingDraft(draft());
    expect(await flushPendingDrafts()).toEqual([]);
    expect(await listPendingDrafts()).toHaveLength(1);
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
    vi.spyOn(api, "createEmailDraft").mockImplementation((async (input: {
      subject: string;
    }) => {
      seen.push(input.subject);
      return { id: "s", updatedAt: "x" };
    }) as never);

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

  it("retains a rejected draft without blocking the queue behind it", async () => {
    vi.spyOn(api, "createEmailDraft")
      .mockRejectedValueOnce(new ApiError("Draft no longer exists", 404))
      .mockResolvedValueOnce({ id: "server-2", updatedAt: "x" } as never);

    await savePendingDraft(
      draft({ localId: "doomed", updatedAt: "2026-08-07T09:00:00.000Z" })
    );
    await savePendingDraft(
      draft({ localId: "fine", updatedAt: "2026-08-07T10:00:00.000Z" })
    );

    const synced = await flushPendingDrafts();

    // Refused content remains recoverable; unrelated drafts still sync.
    expect(synced.map((entry) => entry.localId)).toEqual(["fine"]);
    expect((await listPendingDrafts()).map((entry) => entry.localId)).toEqual([
      "doomed",
    ]);
  });

  it("keeps an edit made while the old snapshot was saving and adopts its server ID", async () => {
    const original = draft();
    await savePendingDraft(original);
    const newer = draft({
      payload: { ...original.payload, html: "<p>New writing</p>" },
    });
    await savePendingDraft(newer);
    await acknowledgePendingDraft(original, "server-1");
    expect(await listPendingDrafts()).toEqual([
      { ...newer, draftId: "server-1" },
    ]);
  });

  it("does not acknowledge a backup belonging to another signed-in person", async () => {
    await savePendingDraft(draft({ userId: "other-user" }));
    await acknowledgePendingDraft(draft(), "server-1");
    expect(db.rows.size).toBe(1);
  });

  it("never downgrades a newer device revision when an older save returns late", async () => {
    const original = draft({ draftId: "server-1", revision: 2 });
    await savePendingDraft(
      draft({
        ...original,
        revision: 5,
        payload: { ...original.payload, html: "<p>Latest writing</p>" },
      })
    );
    await acknowledgePendingDraft(original, "server-1", 3);
    expect((await listPendingDrafts())[0]).toMatchObject({
      revision: 5,
      payload: { html: "<p>Latest writing</p>" },
    });
  });

  it("serializes simultaneous reconnect flushes so they create only one server draft", async () => {
    const create = vi
      .spyOn(api, "createEmailDraft")
      .mockResolvedValue({ id: "server-1" } as never);
    await savePendingDraft(draft());
    const results = await Promise.all([
      flushPendingDrafts(),
      flushPendingDrafts(),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.length)).toEqual([1, 0]);
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
