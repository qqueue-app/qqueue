import {
  openRowMenu,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({ current: { currentOrganizationId: "org_1" } }));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session.current }));

vi.mock("../lib/api.js", () => ({
  api: {
    listContacts: vi.fn(),
    listContactLists: vi.fn(),
    createContactList: vi.fn(),
    updateContactList: vi.fn(),
    deleteContactList: vi.fn()
  }
}));

import { ContactLists } from "./ContactLists.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const contacts = [
  { id: "c1", organizationId: "org_1", email: "a@x.com", status: "ACTIVE" },
  { id: "c2", organizationId: "org_1", email: "b@x.com", status: "ACTIVE" }
];

const list = {
  id: "l1",
  organizationId: "org_1",
  name: "VIPs",
  contacts: [contacts[0]],
  _count: { contacts: 1, campaigns: 2 }
};

describe("ContactLists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("shows the empty state", async () => {
    mockedApi.listContacts.mockResolvedValue([]);
    mockedApi.listContactLists.mockResolvedValue([]);
    renderWithProviders(<ContactLists />);
    expect(await screen.findByText("No lists yet")).toBeInTheDocument();
  });

  it("renders lists with member preview and campaign count", async () => {
    mockedApi.listContacts.mockResolvedValue(contacts);
    mockedApi.listContactLists.mockResolvedValue([list]);
    renderWithProviders(<ContactLists />);
    expect(await screen.findByText("VIPs")).toBeInTheDocument();
    expect(screen.getByText("2 campaigns")).toBeInTheDocument();
    expect(screen.getByText("1 person")).toBeInTheDocument();
  });

  it("filters lists by search", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(contacts);
    mockedApi.listContactLists.mockResolvedValue([list]);
    renderWithProviders(<ContactLists />);
    await screen.findByText("VIPs");
    await user.type(screen.getByPlaceholderText("Search lists…"), "zzz");
    expect(await screen.findByText("No matching lists")).toBeInTheDocument();
  });

  it("creates a list with selected contacts", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(contacts);
    mockedApi.listContactLists.mockResolvedValue([]);
    mockedApi.createContactList.mockResolvedValue({ id: "l2" });
    renderWithProviders(<ContactLists />);
    await screen.findByText("No lists yet");
    await user.click(screen.getAllByRole("button", { name: /New list/i })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "New list");
    await user.click(within(dialog).getByLabelText("Include a@x.com"));
    await user.click(
      within(dialog).getByRole("button", { name: "Create list" })
    );
    await waitFor(() =>
      expect(mockedApi.createContactList).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New list", contactIds: ["c1"] })
      )
    );
  });

  it("edits an existing list", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(contacts);
    mockedApi.listContactLists.mockResolvedValue([list]);
    mockedApi.updateContactList.mockResolvedValue({ id: "l1" });
    renderWithProviders(<ContactLists />);
    await screen.findByText("VIPs");
    await user.click(screen.getByLabelText("Edit this list"));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    );
    await waitFor(() =>
      expect(mockedApi.updateContactList).toHaveBeenCalledWith(
        "l1",
        expect.objectContaining({ name: "VIPs" })
      )
    );
  });

  it("deletes a list", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(contacts);
    mockedApi.listContactLists.mockResolvedValue([list]);
    mockedApi.deleteContactList.mockResolvedValue(undefined);
    renderWithProviders(<ContactLists />);
    await screen.findByText("VIPs");
    // Deleting is a secondary action, so it lives in the row's overflow menu.
    await openRowMenu(user, "VIPs");
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete this list" })
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockedApi.deleteContactList).toHaveBeenCalledWith("l1")
    );
  });

  it("toasts on load failure", async () => {
    mockedApi.listContacts.mockRejectedValue(new Error("bad"));
    mockedApi.listContactLists.mockResolvedValue([]);
    renderWithProviders(<ContactLists />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bad"));
  });
});
