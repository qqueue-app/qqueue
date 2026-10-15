import { afterEach, describe, expect, it } from "vitest";
import {
  retainWindowDraft,
  releaseWindowDraft,
  markWindowDraftVolatile,
  listWindowDrafts,
  windowDraftCount,
  forgetWindowDraft,
  acknowledgeWindowDraft,
} from "./window-drafts.js";
import type { PendingDraft } from "./offline-drafts.js";
const snapshot: PendingDraft = {
  userId: "owner",
  organizationId: "org",
  localId: "copy",
  draftId: null,
  payload: {
    subject: "Private writing",
    html: "<p>Original</p>",
    to: [],
    cc: [],
    bcc: [],
    listIds: [],
  },
  updatedAt: "2026-10-15T12:00:00Z",
};
afterEach(() => {
  for (const user of ["owner", "other"])
    for (const copy of listWindowDrafts(user)) forgetWindowDraft(copy.localId);
});
describe("volatile writing recovery", () => {
  it("retains private file bytes and separates people and organizations", () => {
    const file = new File(["private bytes"], "private.txt");
    const copy = retainWindowDraft({
      ...snapshot,
      pendingUploads: [{ file, uploadId: "upload", error: "Waiting" }],
    });
    markWindowDraftVolatile(copy);
    expect(windowDraftCount("owner")).toBe(1);
    expect(listWindowDrafts("owner", "org")[0]).toMatchObject({
      memoryOnly: true,
      pendingUploads: [{ file }],
    });
    expect(listWindowDrafts("other")).toEqual([]);
    expect(listWindowDrafts("owner", "other-org")).toEqual([]);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("does not release newer writing when an older storage write finishes", () => {
    const older = retainWindowDraft(snapshot);
    const newer = retainWindowDraft({
      ...snapshot,
      payload: { ...snapshot.payload, html: "Newer" },
    });
    markWindowDraftVolatile(newer);
    releaseWindowDraft(older);
    expect(listWindowDrafts("owner")[0].payload.html).toBe("Newer");
    releaseWindowDraft(newer);
    expect(listWindowDrafts("owner")).toEqual([]);
    expect(windowDraftCount("owner")).toBe(0);
  });
  it("adopts a late server identity without deleting newer writing or pending files", () => {
    const file = new File(["bytes"], "waiting.txt");
    retainWindowDraft({
      ...snapshot,
      payload: { ...snapshot.payload, html: "Newer" },
      pendingUploads: [{ file, uploadId: "upload", error: "Waiting" }],
    });
    acknowledgeWindowDraft(snapshot, "server", 2);
    expect(listWindowDrafts("owner")[0]).toMatchObject({
      draftId: "server",
      revision: 2,
      payload: { html: "Newer" },
      pendingUploads: [{ file }],
    });
    const current = listWindowDrafts("owner")[0];
    acknowledgeWindowDraft(current, "server", 2);
    expect(listWindowDrafts("owner")).toHaveLength(1);
    acknowledgeWindowDraft({ ...current, userId: "other" }, "foreign", 99);
    expect(listWindowDrafts("owner")[0].draftId).toBe("server");
  });
  it("releases an exactly acknowledged text snapshot including its volatile marker", () => {
    const copy = retainWindowDraft(snapshot);
    markWindowDraftVolatile(copy);
    acknowledgeWindowDraft(listWindowDrafts("owner")[0], "server", 1);
    expect(listWindowDrafts("owner")).toEqual([]);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
