import {
  openRowMenu,
  renderWithProviders,
  screen,
  waitFor,
} from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom"
    );
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../lib/api.js", () => ({
  api: { listEmailDrafts: vi.fn(), deleteEmailDraft: vi.fn() }
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" })
}));

import { api } from "../lib/api.js";
import { Drafts } from "./Drafts.js";

const mockedApi = api as unknown as {
  listEmailDrafts: ReturnType<typeof vi.fn>;
  deleteEmailDraft: ReturnType<typeof vi.fn>;
};

const draft = {
  id: "drf_1",
  organizationId: "org_1",
  createdByUserId: "usr_1",
  subject: "Half-written",
  to: ["a@x.com", "b@x.com"],
  cc: [],
  bcc: [],
  contactIds: [],
  listIds: [],
  createdAt: "2026-07-20T09:00:00.000Z",
  updatedAt: "2026-07-21T09:00:00.000Z"
};

function renderDrafts() {
  return renderWithProviders(
    <MemoryRouter>
      <Drafts />
    </MemoryRouter>
  , { withRouter: false });
}

describe("Drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listEmailDrafts.mockResolvedValue([draft]);
    mockedApi.deleteEmailDraft.mockResolvedValue(undefined);
  });

  it("lists saved drafts with their recipients", async () => {
    renderDrafts();

    expect(await screen.findByText("Half-written")).toBeInTheDocument();
    expect(screen.getByText("a@x.com, b@x.com")).toBeInTheDocument();
  });

  it("falls back to a placeholder for an untitled, unaddressed draft", async () => {
    mockedApi.listEmailDrafts.mockResolvedValue([
      { ...draft, subject: "", to: [], listIds: ["list_1"] }
    ]);
    renderDrafts();

    expect(await screen.findByText("(no subject)")).toBeInTheDocument();
    expect(screen.getByText("1 contact list")).toBeInTheDocument();
  });

  it("opens a draft in the composer by id", async () => {
    const user = userEvent.setup();
    renderDrafts();

    await user.click(await screen.findByText("Half-written"));

    // The composer owns draft loading; the page only hands over the id.
    expect(navigate).toHaveBeenCalledWith("/email-studio?draft=drf_1");
  });

  it("deletes a draft after confirmation", async () => {
    const user = userEvent.setup();
    renderDrafts();
    await screen.findByText("Half-written");

    // Deleting is a secondary action, so it lives in the row's overflow menu.
    await openRowMenu(user, "Half-written");
    await user.click(
      await screen.findByRole("menuitem", { name: /^Delete draft$/ })
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockedApi.deleteEmailDraft).toHaveBeenCalledWith("drf_1")
    );
    // The list re-reads from the server rather than pruning the row locally,
    // so the mocked API still returns it — what matters is that the delete was
    // sent and the outcome was reported.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Draft deleted.")
    );
  });

  it("invites the user to start writing when there is nothing saved", async () => {
    mockedApi.listEmailDrafts.mockResolvedValue([]);
    renderDrafts();

    expect(await screen.findByText("No drafts yet")).toBeInTheDocument();
  });
});
