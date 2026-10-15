import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { onlineManager } from "@tanstack/react-query";
import { renderWithProviders, screen, act, waitFor } from "../test/render.js";
import { WindowDraftNotice } from "./WindowDraftNotice.js";
import {
  retainWindowDraft,
  markWindowDraftVolatile,
  listWindowDrafts,
  forgetWindowDraft,
} from "../lib/window-drafts.js";
import type { PendingDraft } from "../lib/offline-drafts.js";
const switchOrg = vi.hoisted(() => vi.fn());
vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({
    user: { id: "owner" },
    organizations: [{ id: "other-org", name: "Second organization" }],
    setCurrentOrganizationId: switchOrg,
  }),
}));
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function keep(overrides: Partial<PendingDraft> = {}) {
  const copy = retainWindowDraft({
    userId: "owner",
    organizationId: "other-org",
    localId: "local",
    draftId: null,
    payload: {
      subject: "Window-only draft",
      html: "Private writing",
      to: ["one@example.test"],
      cc: [],
      bcc: ["private@example.test"],
      listIds: [],
    },
    updatedAt: "2026-10-15T12:00:00Z",
    ...overrides,
  });
  markWindowDraftVolatile(copy);
  return copy;
}
afterEach(() => {
  onlineManager.setOnline(true);
  for (const owner of ["owner", "someone-else"])
    for (const copy of listWindowDrafts(owner)) forgetWindowDraft(copy.localId);
  vi.restoreAllMocks();
  switchOrg.mockClear();
});
describe("window writing notice", () => {
  it("reviews the signed-in person's copies offline and opens the exact original identity", async () => {
    keep();
    keep({
      userId: "someone-else",
      localId: "foreign",
      payload: {
        subject: "Foreign writing",
        html: "secret",
        to: [],
        cc: [],
        bcc: [],
        listIds: [],
      },
    });
    act(() => onlineManager.setOnline(false));
    renderWithProviders(
      <>
        <WindowDraftNotice />
        <Location />
      </>
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Review window copies" })
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Window-only draft · Second organization/,
      })
    );
    expect(screen.queryByText(/Foreign writing/)).not.toBeInTheDocument();
    expect(screen.getByText("Bcc: private@example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open this writing" }));
    expect(switchOrg).toHaveBeenCalledWith("other-org");
    expect(screen.getByLabelText("Location")).toHaveTextContent(
      "/email-studio?restore=local"
    );
    expect(listWindowDrafts("owner")).toHaveLength(1);
  });
  it("downloads waiting bytes and writing without sending or discarding either", async () => {
    const file = new File(["exact private bytes"], "waiting.txt");
    keep({ pendingUploads: [{ file, uploadId: "upload", error: "Offline" }] });
    const makeUrl = vi.spyOn(URL, "createObjectURL");
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    renderWithProviders(<WindowDraftNotice />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Review window copies" })
    );
    await user.click(
      await screen.findByRole("button", { name: /Window-only draft ·/ })
    );
    await user.click(
      screen.getByRole("button", { name: "Download waiting file: waiting.txt" })
    );
    expect(makeUrl).toHaveBeenCalledWith(file);
    await user.click(screen.getByRole("button", { name: "Download writing" }));
    expect(makeUrl.mock.calls[1][0]).toBeInstanceOf(Blob);
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(listWindowDrafts("owner")[0].pendingUploads?.[0].file).toBe(file);
  });
});

it("retries failed device persistence offline and clears the volatile notice only after storage accepts it", async () => {
  const { installFakeIndexedDB } = await import("../test/fake-indexeddb.js");
  const db = installFakeIndexedDB();
  try {
    keep();
    act(() => onlineManager.setOnline(false));
    renderWithProviders(<WindowDraftNotice />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Review window copies" })
    );
    await user.click(
      screen.getByRole("button", { name: "Retry device saving" })
    );
    await waitFor(() =>
      expect(db.rows.get("local")).toMatchObject({
        payload: { subject: "Window-only draft" },
      })
    );
    await waitFor(() => expect(listWindowDrafts("owner")).toEqual([]));
    expect(listWindowDrafts("owner")).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Review window copies" })
    ).not.toBeInTheDocument();
  } finally {
    db.restore();
  }
});
