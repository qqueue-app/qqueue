import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({ current: { currentOrganizationId: "org_1" } }));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session.current }));

vi.mock("../lib/api.js", () => ({
  api: {
    listContacts: vi.fn(),
    createContact: vi.fn(),
    updateContact: vi.fn(),
    deleteContact: vi.fn()
  }
}));

import { Contacts } from "./Contacts.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeContacts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    organizationId: "org_1",
    email: `user${i}@x.com`,
    firstName: `First${i}`,
    lastName: "Last",
    status: i === 0 ? "ACTIVE" : i === 1 ? "BOUNCED" : "UNSUBSCRIBED"
  }));
}

describe("Contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("shows the empty state when there are no contacts", async () => {
    mockedApi.listContacts.mockResolvedValue([]);
    render(<Contacts />);
    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
  });

  it("renders contacts with status badges", async () => {
    mockedApi.listContacts.mockResolvedValue(makeContacts(3));
    render(<Contacts />);
    expect(await screen.findByText("user0@x.com")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("BOUNCED")).toBeInTheDocument();
  });

  it("filters by search and shows no-matches state", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(makeContacts(3));
    render(<Contacts />);
    await screen.findByText("user0@x.com");
    await user.type(
      screen.getByPlaceholderText("Search by name or email…"),
      "zzz"
    );
    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });

  it("paginates when there are more than a page of contacts", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(makeContacts(15));
    render(<Contacts />);
    await screen.findByText("user0@x.com");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Next page"));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("creates a contact", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue([]);
    mockedApi.createContact.mockResolvedValue({ id: "c1" });
    render(<Contacts />);
    await screen.findByText("No contacts yet");
    await user.click(
      screen.getAllByRole("button", { name: /Add contact/i })[0]
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Email"), "new@x.com");
    await user.click(
      within(dialog).getByRole("button", { name: "Add contact" })
    );
    await waitFor(() => expect(mockedApi.createContact).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Contact added.");
  });

  it("edits an existing contact", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(makeContacts(1));
    mockedApi.updateContact.mockResolvedValue({ id: "c0" });
    render(<Contacts />);
    await screen.findByText("user0@x.com");
    await user.click(screen.getByLabelText("Edit contact"));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" })
    );
    await waitFor(() =>
      expect(mockedApi.updateContact).toHaveBeenCalledWith(
        "c0",
        expect.objectContaining({ email: "user0@x.com" })
      )
    );
  });

  it("deletes a contact via confirm dialog", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(makeContacts(1));
    mockedApi.deleteContact.mockResolvedValue(undefined);
    render(<Contacts />);
    await screen.findByText("user0@x.com");
    await user.click(screen.getByLabelText("Delete contact"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockedApi.deleteContact).toHaveBeenCalledWith("c0")
    );
    expect(toast.success).toHaveBeenCalledWith("Contact removed.");
  });

  it("toasts on load failure", async () => {
    mockedApi.listContacts.mockRejectedValue(new Error("load fail"));
    render(<Contacts />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("load fail"));
  });

  it("disables actions and warns when no organization is selected", async () => {
    session.current = { currentOrganizationId: undefined } as never;
    render(<Contacts />);
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /Add contact/i })[0]
      ).toBeDisabled()
    );
    expect(mockedApi.listContacts).not.toHaveBeenCalled();
  });
});
