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
    deleteContact: vi.fn(),
    importContacts: vi.fn(),
    previewImportContacts: vi.fn(),
    exportContacts: vi.fn(),
    getContactActivity: vi.fn(),
    previewSegment: vi.fn(),
    createListFromSegment: vi.fn(),
    listContactLists: vi.fn(),
    bulkDeleteContacts: vi.fn()
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
    mockedApi.listContactLists.mockResolvedValue([]);
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

  it("opens the activity drawer for a contact", async () => {
    const user = userEvent.setup();
    mockedApi.listContacts.mockResolvedValue(makeContacts(1));
    mockedApi.getContactActivity.mockResolvedValue({
      events: [
        {
          id: "e1",
          type: "CLICKED",
          occurredAt: "2026-02-01T00:00:00.000Z",
          emailJobId: "job_1",
          subject: "Welcome",
          origin: "CAMPAIGN",
          campaignName: "Spring",
          url: "https://x.com"
        }
      ],
      nextCursor: null
    });
    render(<Contacts />);
    await screen.findByText("user0@x.com");

    await user.click(screen.getByLabelText("View activity"));

    await waitFor(() =>
      expect(mockedApi.getContactActivity).toHaveBeenCalledWith("c0")
    );
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("CLICKED")).toBeInTheDocument();
  });

  it("exports contacts to a CSV download", async () => {
    mockedApi.listContacts.mockResolvedValue(makeContacts(1));
    mockedApi.exportContacts.mockResolvedValue("email\nuser0@x.com\n");
    const createObjectURL = vi.fn(() => "blob:csv");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const user = userEvent.setup();
    render(<Contacts />);
    await screen.findByText("user0@x.com");

    await user.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() =>
      expect(mockedApi.exportContacts).toHaveBeenCalledWith("org_1")
    );
    expect(createObjectURL).toHaveBeenCalled();
  });
});

describe("Contacts import dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
    mockedApi.listContacts.mockResolvedValue(makeContacts(1));
    mockedApi.listContactLists.mockResolvedValue([
      { id: "list_1", name: "VIPs" }
    ]);
    mockedApi.importContacts.mockResolvedValue({
      created: 2,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      suppressed: 0,
      errors: []
    });
    mockedApi.previewImportContacts.mockResolvedValue(makePreview());
  });

  function makePreview(overrides: Record<string, unknown> = {}) {
    return {
      totalRows: 2,
      newCount: 2,
      duplicateCount: 0,
      suppressedCount: 0,
      collapsedInFile: 0,
      errors: [],
      duplicates: [],
      duplicatesTruncated: false,
      newSample: [],
      ...overrides
    };
  }

  function makeDuplicate(overrides: Record<string, unknown> = {}) {
    return {
      email: "dup@x.com",
      incoming: { firstName: "New", tags: ["fresh"] },
      existing: {
        id: "c_dup",
        firstName: "Old",
        lastName: null,
        tags: ["old"],
        status: "ACTIVE"
      },
      suppressed: false,
      changedFields: ["firstName", "tags"],
      ...overrides
    };
  }

  async function openImportDialog(user: ReturnType<typeof userEvent.setup>) {
    render(<Contacts />);
    await screen.findByText("user0@x.com");
    const file = new File(["email\na@b.com\n"], "contacts.csv", {
      type: "text/csv"
    });
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, file);
    return file;
  }

  /** Walk from file choice through the dry run to the review step. */
  async function reachReviewStep(user: ReturnType<typeof userEvent.setup>) {
    await openImportDialog(user);
    await screen.findByText("Import contacts");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText("Review this import");
  }

  it("opens a dialog on file choice instead of importing immediately", async () => {
    const user = userEvent.setup();
    await openImportDialog(user);

    expect(await screen.findByText("Import contacts")).toBeInTheDocument();
    // Choosing a file must not send it on its own.
    expect(mockedApi.importContacts).not.toHaveBeenCalled();
    expect(mockedApi.previewImportContacts).not.toHaveBeenCalled();
    expect(screen.getByText("contacts.csv")).toBeInTheDocument();
  });

  // The dry run is what makes a duplicate a decision rather than a silent merge,
  // so "Continue" must never write.
  it("dry-runs before writing anything", async () => {
    const user = userEvent.setup();
    await reachReviewStep(user);

    expect(mockedApi.previewImportContacts).toHaveBeenCalled();
    expect(mockedApi.importContacts).not.toHaveBeenCalled();
  });

  it("imports without a list by default", async () => {
    const user = userEvent.setup();
    await reachReviewStep(user);

    await user.click(screen.getByRole("button", { name: /^import 2 contacts$/i }));

    await waitFor(() => expect(mockedApi.importContacts).toHaveBeenCalled());
    const [, options] = mockedApi.importContacts.mock.calls[0];
    expect(options).toEqual({
      organizationId: "org_1",
      contactListId: undefined,
      contactListName: undefined,
      defaultResolution: "MERGE",
      overrides: {}
    });
  });

  it("imports straight into a new list named in the dialog", async () => {
    const user = userEvent.setup();
    mockedApi.importContacts.mockResolvedValue({
      created: 2,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      suppressed: 0,
      errors: [],
      contactList: { id: "list_new", name: "Newsletter", created: true }
    });
    await openImportDialog(user);
    await screen.findByText("Import contacts");

    await user.click(screen.getByLabelText("Add to a list"));
    await user.click(await screen.findByRole("option", { name: /new list/i }));
    await user.type(screen.getByLabelText("New list name"), "Newsletter");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText("Review this import");
    await user.click(screen.getByRole("button", { name: /^import 2 contacts$/i }));

    await waitFor(() => expect(mockedApi.importContacts).toHaveBeenCalled());
    const [, options] = mockedApi.importContacts.mock.calls[0];
    expect(options).toMatchObject({ contactListName: "Newsletter" });
    expect(options.contactListId).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Newsletter")
    );
  });

  it("shows what each existing contact looks like before and after", async () => {
    const user = userEvent.setup();
    mockedApi.previewImportContacts.mockResolvedValue(
      makePreview({
        totalRows: 1,
        newCount: 0,
        duplicateCount: 1,
        duplicates: [makeDuplicate()]
      })
    );
    await reachReviewStep(user);

    expect(screen.getByText("dup@x.com")).toBeInTheDocument();
    // "Now" is the stored contact; "After import" is the merged result — the
    // file's name wins where it has one, and its tags join the existing set.
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("old")).toBeInTheDocument();
    expect(screen.getByText("old, fresh")).toBeInTheDocument();
  });

  it("sends a per-row choice as an override alongside the default", async () => {
    const user = userEvent.setup();
    mockedApi.previewImportContacts.mockResolvedValue(
      makePreview({
        totalRows: 2,
        newCount: 1,
        duplicateCount: 1,
        duplicates: [makeDuplicate()]
      })
    );
    await reachReviewStep(user);

    await user.click(
      screen.getByLabelText("What to do with dup@x.com")
    );
    await user.click(await screen.findByRole("option", { name: /^replace$/i }));
    await user.click(screen.getByRole("button", { name: /^import 2 contacts$/i }));

    await waitFor(() => expect(mockedApi.importContacts).toHaveBeenCalled());
    const [, options] = mockedApi.importContacts.mock.calls[0];
    expect(options.defaultResolution).toBe("MERGE");
    expect(options.overrides).toEqual({
      "dup@x.com": { resolution: "REPLACE" }
    });
  });

  it("carries an inline edit through to the import", async () => {
    const user = userEvent.setup();
    mockedApi.previewImportContacts.mockResolvedValue(
      makePreview({
        totalRows: 1,
        newCount: 0,
        duplicateCount: 1,
        duplicates: [makeDuplicate()]
      })
    );
    await reachReviewStep(user);

    await user.click(screen.getByRole("button", { name: /edit dup@x.com/i }));
    const firstName = screen.getByLabelText("First name");
    await user.clear(firstName);
    await user.type(firstName, "Corrected");
    await user.click(screen.getByRole("button", { name: /^import 1 contact$/i }));

    await waitFor(() => expect(mockedApi.importContacts).toHaveBeenCalled());
    const [, options] = mockedApi.importContacts.mock.calls[0];
    expect(options.overrides["dup@x.com"]).toMatchObject({
      firstName: "Corrected"
    });
  });

  // Duplicates past the display cap still import — saying so keeps the capped
  // list from reading as the whole picture.
  it("says how many existing contacts are beyond the displayed list", async () => {
    const user = userEvent.setup();
    mockedApi.previewImportContacts.mockResolvedValue(
      makePreview({
        totalRows: 600,
        newCount: 0,
        duplicateCount: 600,
        duplicates: [makeDuplicate()],
        duplicatesTruncated: true
      })
    );
    await reachReviewStep(user);

    expect(screen.getByText(/599 are imported using the choice above/i))
      .toBeInTheDocument();
  });

  it("goes back to the options step without importing", async () => {
    const user = userEvent.setup();
    await reachReviewStep(user);

    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(await screen.findByText("Import contacts")).toBeInTheDocument();
    expect(mockedApi.importContacts).not.toHaveBeenCalled();
  });

  it("keeps per-row errors visible instead of discarding them", async () => {
    const user = userEvent.setup();
    mockedApi.importContacts.mockResolvedValue({
      created: 1,
      updated: 0,
      unchanged: 0,
      skipped: 2,
      suppressed: 0,
      errors: [
        { row: 3, message: "Missing email" },
        { row: 7, message: "Invalid email: nope" }
      ]
    });
    await reachReviewStep(user);

    await user.click(screen.getByRole("button", { name: /^import 2 contacts$/i }));

    expect(
      await screen.findByText(/2 rows couldn't be read/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Row 3: Missing email/)).toBeInTheDocument();
    expect(screen.getByText(/Row 7: Invalid email/)).toBeInTheDocument();
    // Dialog stays open so the reasons remain readable.
    expect(screen.getByText("Review this import")).toBeInTheDocument();
  });
});

describe("Contacts bulk delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
    mockedApi.listContacts.mockResolvedValue(makeContacts(3));
    mockedApi.listContactLists.mockResolvedValue([]);
    mockedApi.bulkDeleteContacts.mockResolvedValue({ deleted: 2 });
  });

  it("shows no bulk bar until something is selected", async () => {
    render(<Contacts />);
    await screen.findByText("user0@x.com");

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("deletes the selected contacts", async () => {
    const user = userEvent.setup();
    render(<Contacts />);
    await screen.findByText("user0@x.com");

    await user.click(screen.getByLabelText("Select user0@x.com"));
    await user.click(screen.getByLabelText("Select user1@x.com"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete selected/i }));
    await user.click(
      await screen.findByRole("button", { name: /^delete$/i })
    );

    await waitFor(() =>
      expect(mockedApi.bulkDeleteContacts).toHaveBeenCalledWith("org_1", [
        "c0",
        "c1"
      ])
    );
  });

  it("select-all covers every filtered contact, not just the visible page", async () => {
    const user = userEvent.setup();
    render(<Contacts />);
    await screen.findByText("user0@x.com");

    await user.click(screen.getByLabelText("Select all matching contacts"));

    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("clears the selection", async () => {
    const user = userEvent.setup();
    render(<Contacts />);
    await screen.findByText("user0@x.com");

    await user.click(screen.getByLabelText("Select user0@x.com"));
    await user.click(screen.getByRole("button", { name: /clear selection/i }));

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });
});
