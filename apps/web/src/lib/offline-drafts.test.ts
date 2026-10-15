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

const draftKeys = new Set<string>();
function draft(overrides: Partial<PendingDraft> = {}): PendingDraft {
  draftKeys.add(overrides.localId ?? "local-1");
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

  afterEach(async () => {
    for (const key of draftKeys) await deletePendingDraft(key);
    draftKeys.clear();
    db.restore();
    localStorage.removeItem("qqueue.session");
    vi.restoreAllMocks();
  });

  it("does not resubmit acknowledged writing just because private file bytes are still waiting", async () => {
    const snapshot = draft({
      draftId: "server-1",
      revision: 1,
      pendingUploads: [
        {
          file: new File(["private bytes"], "waiting.txt"),
          uploadId: "file-retry1",
          error: "offline",
        },
      ],
    });
    await savePendingDraft(snapshot);
    await acknowledgePendingDraft(snapshot, "server-1", 2);
    const update = vi
      .spyOn(api, "updateEmailDraft")
      .mockResolvedValue({ id: "server-1", revision: 3 } as never);
    expect(await flushPendingDrafts("org-1")).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    let retained = (await listPendingDrafts("org-1"))[0];
    expect(retained.pendingUploads?.[0].file.size).toBe(13);
    await savePendingDraft({
      ...retained,
      payload: { ...retained.payload, html: "<p>New writing</p>" },
    });
    await flushPendingDrafts("org-1");
    expect(update).toHaveBeenCalledWith(
      "server-1",
      expect.objectContaining({
        html: "<p>New writing</p>",
        expectedRevision: 2,
      })
    );
    retained = (await listPendingDrafts("org-1"))[0];
    await savePendingDraft({ ...retained, pendingUploads: [] });
    await flushPendingDrafts("org-1");
    expect(update).toHaveBeenCalledTimes(1);
    expect(await listPendingDrafts("org-1")).toEqual([]);
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
      {
        localId: "local-1",
        draft: { id: "server-1", updatedAt: "x" },
        snapshot: draft(),
      },
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
    const retained = await listPendingDrafts();
    expect(retained).toMatchObject([{ ...newer, draftId: "server-1" }]);
    expect(retained[0].serverWritingFingerprint).toContain("<p>Hi</p>");
    expect(retained[0].serverWritingFingerprint).not.toContain("New writing");
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

  it("retains a clearly volatile copy when IndexedDB is unavailable", async () => {
    db.failNextOpen();
    // Private browsing rejects the open outright. A composer that threw here
    // would lose the message it was trying to protect.
    await expect(savePendingDraft(draft())).resolves.toBe(false);

    db.failNextOpen();
    await expect(listPendingDrafts()).resolves.toEqual([
      expect.objectContaining({
        localId: "local-1",
        memoryOnly: true,
        payload: draft().payload,
      }),
    ]);
  });
});

it("keeps separate local records while retrying one server creation identity", async () => {
  const db = installFakeIndexedDB();
  localStorage.setItem(
    "qqueue.session",
    JSON.stringify({ user: { id: "user-1" }, organizations: [] })
  );
  const create = vi
    .spyOn(api, "createEmailDraft")
    .mockResolvedValue({ id: "same-server-draft", revision: 1 } as never);
  try {
    await savePendingDraft(
      draft({
        localId: "tab-one",
        clientId: "one-creation",
        payload: { ...draft().payload, subject: "First version" },
      })
    );
    await savePendingDraft(
      draft({
        localId: "tab-two",
        clientId: "one-creation",
        payload: { ...draft().payload, subject: "Second version" },
      })
    );
    expect((await listPendingDrafts()).map((record) => record.localId)).toEqual(
      ["tab-one", "tab-two"]
    );
    await flushPendingDrafts();
    expect(create.mock.calls.map((call) => call[0].clientId)).toEqual([
      "one-creation",
      "one-creation",
    ]);
  } finally {
    db.restore();
    vi.restoreAllMocks();
  }
});

it("reports a rejected concurrent version while retaining its device copy", async () => {
  const db = installFakeIndexedDB();
  localStorage.setItem(
    "qqueue.session",
    JSON.stringify({ user: { id: "user-1" }, organizations: [] })
  );
  vi.spyOn(api, "updateEmailDraft").mockRejectedValue(
    new ApiError("Draft changed elsewhere", 409)
  );
  const rejected = vi.fn();
  try {
    await savePendingDraft(draft({ draftId: "server1", revision: 1 }));
    await flushPendingDrafts("org-1", rejected);
    expect(rejected).toHaveBeenCalledWith(
      "local-1",
      expect.objectContaining({ status: 409 })
    );
    expect((await listPendingDrafts("org-1"))[0].payload.html).toBe(
      "<p>Hi</p>"
    );
  } finally {
    db.restore();
    vi.restoreAllMocks();
  }
});
