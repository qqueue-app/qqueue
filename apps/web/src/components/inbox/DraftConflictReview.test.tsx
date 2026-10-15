import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { api, type EmailDraft } from "../../lib/api.js";
import { DraftConflictReview } from "./DraftConflictReview.js";
vi.mock("../../lib/api.js", () => ({
  api: { getEmailDraft: vi.fn(), listEmailDrafts: vi.fn() },
}));
const use = vi.fn(),
  accepted = vi.fn();
const saved = {
  id: "d1",
  organizationId: "org1",
  revision: 2,
  subject: "Saved subject",
  html: "<p>Saved writing</p>",
  to: ["one@example.com"],
  cc: ["copy@example.com"],
  bcc: ["private@example.com"],
  attachments: [{ id: "file1", filename: "private.txt" }],
} as EmailDraft;
function renderReview(draftId: string | null = "d1") {
  return renderWithProviders(
    <DraftConflictReview
      organizationId="org1"
      draftId={draftId ?? undefined}
      clientId="client1"
      onUse={use}
      onAccepted={accepted}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getEmailDraft).mockResolvedValue(saved);
  vi.mocked(api.listEmailDrafts).mockResolvedValue([
    { ...saved, clientId: "client1" },
  ]);
});
describe("draft conflict comparison", () => {
  it("shows the saved recipients, body and files before replacing local writing", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(
      screen.getByRole("button", { name: "Compare saved version" })
    );
    expect(
      await screen.findByText("Subject: Saved subject")
    ).toBeInTheDocument();
    expect(screen.getByText("Bcc: private@example.com")).toBeInTheDocument();
    expect(screen.getByText("private.txt")).toBeInTheDocument();
    expect(screen.getByTitle("Saved draft version")).toHaveAttribute(
      "srcdoc",
      "<p>Saved writing</p>"
    );
    expect(use).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use saved version" }));
    await waitFor(() => expect(use).toHaveBeenCalledWith(saved));
  });
  it("rechecks the revision and file set when a second device changes the compared draft", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(
      screen.getByRole("button", { name: "Compare saved version" })
    );
    await screen.findByText("private.txt");
    vi.mocked(api.getEmailDraft).mockResolvedValue({
      ...saved,
      revision: 3,
      html: "<p>Newer writing</p>",
      attachments: [],
    });
    await user.click(screen.getByRole("button", { name: "Use saved version" }));
    await waitFor(() =>
      expect(screen.getByTitle("Saved draft version")).toHaveAttribute(
        "srcdoc",
        "<p>Newer writing</p>"
      )
    );
    expect(use).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use saved version" }));
    await waitFor(() => expect(use).toHaveBeenCalledOnce());
  });
  it("finds a creation retry by its client identity", async () => {
    const user = userEvent.setup();
    renderReview(null);
    await user.click(
      screen.getByRole("button", { name: "Compare saved version" })
    );
    await screen.findByText("private.txt");
    expect(api.listEmailDrafts).toHaveBeenCalledWith("org1");
    expect(api.getEmailDraft).toHaveBeenCalledWith("d1");
  });
  it("recovers accepted delivery instead of replacing or resending a completed draft", async () => {
    vi.mocked(api.getEmailDraft).mockResolvedValue({
      ...saved,
      completedSendId: "job1",
    });
    const user = userEvent.setup();
    renderReview();
    await user.click(
      screen.getByRole("button", { name: "Compare saved version" })
    );
    await waitFor(() => expect(accepted).toHaveBeenCalledWith("job1"));
    expect(use).not.toHaveBeenCalled();
  });
  it("keeps local writing when the saved version is unavailable or belongs to another organization", async () => {
    vi.mocked(api.getEmailDraft).mockResolvedValue({
      ...saved,
      organizationId: "other",
    });
    const user = userEvent.setup();
    renderReview();
    await user.click(
      screen.getByRole("button", { name: "Compare saved version" })
    );
    await waitFor(() => expect(api.getEmailDraft).toHaveBeenCalled());
    expect(use).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Saved draft version")).not.toBeInTheDocument();
  });
});
