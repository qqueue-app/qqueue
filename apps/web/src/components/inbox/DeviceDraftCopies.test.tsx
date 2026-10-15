import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import {
  installFakeIndexedDB,
  type FakeIndexedDB,
} from "../../test/fake-indexeddb.js";
import {
  listPendingDrafts,
  savePendingDraft,
  type PendingDraft,
} from "../../lib/offline-drafts.js";
import { DeviceDraftCopies } from "./DeviceDraftCopies.js";
let db: FakeIndexedDB;
const useCopy = vi.fn().mockResolvedValue(undefined);
const copy: PendingDraft = {
  userId: "u",
  organizationId: "o",
  localId: "one",
  clientId: "server-one",
  draftId: "d1",
  revision: 1,
  updatedAt: "2026-10-15T10:00:00Z",
  payload: {
    subject: "Unsent writing",
    html: "<p>Device copy writing</p>",
    to: ["reader@example.com"],
    cc: ["cc@example.com"],
    bcc: ["bcc@example.com"],
    listIds: [],
  },
  attachments: [{ id: "file1", filename: "saved-file.txt" }] as never,
  pendingUploads: [
    {
      file: new File(["bytes"], "pending.txt"),
      uploadId: "file2",
      error: "offline",
    },
  ],
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "qqueue.session",
    JSON.stringify({ user: { id: "u" }, organizations: [] })
  );
  db = installFakeIndexedDB();
  vi.clearAllMocks();
});
afterEach(() => {
  db.restore();
  vi.restoreAllMocks();
});
function renderCopies() {
  return renderWithProviders(
    <DeviceDraftCopies organizationId="o" userId="u" onUse={useCopy} />
  );
}
it("reviews only this account's ordinary drafts with uploaded and pending files before using one", async () => {
  await savePendingDraft(copy);
  await savePendingDraft({
    ...copy,
    localId: "other-user",
    userId: "another",
    payload: { ...copy.payload, subject: "Other user private writing" },
  });
  await savePendingDraft({
    ...copy,
    localId: "reply",
    payload: {
      ...copy.payload,
      inboundMessageId: "m1",
      subject: "Reply private writing",
    },
  });
  renderCopies();
  await userEvent.click(
    screen.getByRole("button", { name: "Review device drafts" })
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /Unsent writing/ })
  );
  expect(screen.getByTitle("Device draft copy")).toHaveAttribute(
    "srcdoc",
    expect.stringContaining("Device copy writing")
  );
  expect(screen.getByText("saved-file.txt")).toBeInTheDocument();
  expect(screen.getByText(/pending.txt/)).toBeInTheDocument();
  expect(
    screen.queryByText("Other user private writing")
  ).not.toBeInTheDocument();
  expect(useCopy).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Use this device draft" })
  );
  await waitFor(() =>
    expect(useCopy).toHaveBeenCalledWith(
      expect.objectContaining({ localId: "one", clientId: "server-one" })
    )
  );
  expect(
    (await listPendingDrafts("o")).some((entry) => entry.localId === "one")
  ).toBe(true);
});
it("keeps review and original writing when preserving the current composer fails", async () => {
  await savePendingDraft(copy);
  useCopy.mockRejectedValueOnce(new Error("offline and storage full"));
  renderCopies();
  await userEvent.click(
    screen.getByRole("button", { name: "Review device drafts" })
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /Unsent writing/ })
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Use this device draft" })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't preserve your current writing"
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("reports an unavailable device store instead of claiming that no copies exist", async () => {
  vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new Error("blocked");
  });
  renderCopies();
  await userEvent.click(
    screen.getByRole("button", { name: "Review device drafts" })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't read device drafts"
  );
});

it("reads local recovery copies even while server queries are paused offline", async () => {
  await savePendingDraft(copy);
  act(() => onlineManager.setOnline(false));
  try {
    renderCopies();
    await userEvent.click(
      screen.getByRole("button", { name: "Review device drafts" })
    );
    expect(
      await screen.findByRole("button", { name: /Unsent writing/ })
    ).toBeInTheDocument();
  } finally {
    act(() => onlineManager.setOnline(true));
  }
});
