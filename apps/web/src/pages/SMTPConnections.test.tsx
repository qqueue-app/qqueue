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

// Mutable so individual tests can view the page as a MEMBER; the default is
// an OWNER, who sees every control.
const session = vi.hoisted(() => ({
  current: {
    currentOrganizationId: "org_1",
    currentOrganization: { id: "org_1", name: "Acme", role: "OWNER" }
  } as {
    currentOrganizationId: string;
    currentOrganization?: { id: string; name: string; role?: string };
  }
}));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session.current }));

vi.mock("../lib/api.js", () => ({
  api: {
    listSMTPConnections: vi.fn(),
    createSMTPConnection: vi.fn(),
    updateSMTPConnection: vi.fn(),
    deleteSMTPConnection: vi.fn(),
    verifySMTPConnection: vi.fn()
  }
}));

import { SMTPConnections } from "./SMTPConnections.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const connection = {
  id: "s1",
  organizationId: "org_1",
  name: "Primary",
  host: "smtp.x.com",
  port: 587,
  secure: false,
  fromEmail: "from@x.com",
  fromName: "From",
  isDefault: true
};

describe("SMTPConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = {
      currentOrganizationId: "org_1",
      currentOrganization: { id: "org_1", name: "Acme", role: "OWNER" }
    };
  });

  it("shows the empty state", async () => {
    mockedApi.listSMTPConnections.mockResolvedValue([]);
    renderWithProviders(<SMTPConnections />);
    expect(
      await screen.findByText("No sending accounts yet")
    ).toBeInTheDocument();
  });

  it("renders connections with badges", async () => {
    mockedApi.listSMTPConnections.mockResolvedValue([connection]);
    renderWithProviders(<SMTPConnections />);
    expect(await screen.findByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("STARTTLS")).toBeInTheDocument();
    expect(screen.getByText(/smtp.x.com:587/)).toBeInTheDocument();
  });

  it("creates a connection", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([]);
    mockedApi.createSMTPConnection.mockResolvedValue({ id: "s2" });
    renderWithProviders(<SMTPConnections />);
    await screen.findByText("No sending accounts yet");
    await user.click(
      screen.getAllByRole("button", { name: /New account/i })[0]
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Host"), "smtp.test.com");
    await user.type(within(dialog).getByLabelText("Username"), "u");
    await user.type(within(dialog).getByLabelText("Password"), "p");
    await user.type(within(dialog).getByLabelText("From email"), "x@y.com");
    await user.click(
      within(dialog).getByRole("button", { name: "Check and create" })
    );
    await waitFor(() =>
      expect(mockedApi.createSMTPConnection).toHaveBeenCalled()
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Checked the credentials and saved the account."
    );
  });

  it("edits a connection, sending credentials only when re-entered", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([connection]);
    mockedApi.updateSMTPConnection.mockResolvedValue({ id: "s1" });
    renderWithProviders(<SMTPConnections />);
    await screen.findByText("Primary");
    // Editing is a secondary action, so it lives in the row's overflow menu.
    await openRowMenu(user, "Primary");
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit this account" })
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Check and save" })
    );
    await waitFor(() =>
      expect(mockedApi.updateSMTPConnection).toHaveBeenCalledWith(
        "s1",
        expect.not.objectContaining({ password: expect.anything() })
      )
    );
  });

  it("deletes a connection", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([connection]);
    mockedApi.deleteSMTPConnection.mockResolvedValue(undefined);
    renderWithProviders(<SMTPConnections />);
    await screen.findByText("Primary");
    await openRowMenu(user, "Primary");
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete this account" })
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockedApi.deleteSMTPConnection).toHaveBeenCalledWith("s1")
    );
  });

  it("toggles the secure and default checkboxes in the form", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([]);
    renderWithProviders(<SMTPConnections />);
    await screen.findByText("No sending accounts yet");
    await user.click(
      screen.getAllByRole("button", { name: /New account/i })[0]
    );
    const dialog = await screen.findByRole("dialog");
    const checkboxes = within(dialog).getAllByRole("checkbox");
    // first checkbox is "Secure TLS" and starts unchecked
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "false");
    await user.click(checkboxes[0]);
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
  });

  it("toasts on load failure", async () => {
    mockedApi.listSMTPConnections.mockRejectedValue(new Error("oops"));
    renderWithProviders(<SMTPConnections />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("oops"));
  });

  describe("Test connection", () => {
    it("toasts success when the credentials verify", async () => {
      const user = userEvent.setup();
      mockedApi.listSMTPConnections.mockResolvedValue([connection]);
      mockedApi.verifySMTPConnection.mockResolvedValue({ verified: true });
      renderWithProviders(<SMTPConnections />);
      await screen.findByText("Primary");

      await user.click(screen.getByLabelText("Check this account still works"));

      await waitFor(() =>
        expect(mockedApi.verifySMTPConnection).toHaveBeenCalledWith("s1")
      );
      // The success replaces the in-flight "Testing…" toast, so it carries
      // that toast's id.
      expect(toast.success).toHaveBeenCalledWith(
        "Primary works.",
        expect.anything()
      );
    });

    it("surfaces the provider message when verification fails", async () => {
      const user = userEvent.setup();
      mockedApi.listSMTPConnections.mockResolvedValue([connection]);
      mockedApi.verifySMTPConnection.mockResolvedValue({
        verified: false,
        message: "The mail server rejected the username or password."
      });
      renderWithProviders(<SMTPConnections />);
      await screen.findByText("Primary");

      await user.click(screen.getByLabelText("Check this account still works"));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "The mail server rejected the username or password.",
          expect.anything()
        )
      );
    });

    it("stays available to MEMBERs (testing changes nothing)", async () => {
      session.current = {
        currentOrganizationId: "org_1",
        currentOrganization: { id: "org_1", name: "Acme", role: "MEMBER" }
      };
      mockedApi.listSMTPConnections.mockResolvedValue([connection]);
      renderWithProviders(<SMTPConnections />);
      await screen.findByText("Primary");
      expect(screen.getByLabelText("Check this account still works")).toBeInTheDocument();
    });
  });

  // Writes are OWNER/ADMIN on the API (Phase 3); members shouldn't see
  // controls that can only end in a 403 toast.
  describe("as a MEMBER", () => {
    beforeEach(() => {
      session.current = {
        currentOrganizationId: "org_1",
        currentOrganization: { id: "org_1", name: "Acme", role: "MEMBER" }
      };
    });

    it("hides the create, edit, and delete controls", async () => {
      mockedApi.listSMTPConnections.mockResolvedValue([connection]);
      renderWithProviders(<SMTPConnections />);
      await screen.findByText("Primary");
      expect(
        screen.queryByRole("button", { name: /New account/i })
      ).not.toBeInTheDocument();
      // A member can still test the account, but every action that would
      // change it is gone — so there is no overflow menu at all.
      expect(
        screen.getByLabelText("Check this account still works")
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "More actions for Primary" })
      ).not.toBeInTheDocument();
    });

    it("points at an owner or admin when there are no accounts", async () => {
      mockedApi.listSMTPConnections.mockResolvedValue([]);
      renderWithProviders(<SMTPConnections />);
      expect(
        await screen.findByText(/owner or admin needs to add one/i)
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /New account/i })
      ).not.toBeInTheDocument();
    });
  });
});
