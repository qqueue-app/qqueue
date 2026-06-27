import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({ current: { currentOrganizationId: "org_1" } }));
vi.mock("../lib/session-context.js", () => ({ useSession: () => session.current }));

vi.mock("../lib/api.js", () => ({
  api: {
    listSMTPConnections: vi.fn(),
    createSMTPConnection: vi.fn(),
    updateSMTPConnection: vi.fn(),
    deleteSMTPConnection: vi.fn()
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
    session.current = { currentOrganizationId: "org_1" };
  });

  it("shows the empty state", async () => {
    mockedApi.listSMTPConnections.mockResolvedValue([]);
    render(<SMTPConnections />);
    expect(
      await screen.findByText("No sending accounts yet")
    ).toBeInTheDocument();
  });

  it("renders connections with badges", async () => {
    mockedApi.listSMTPConnections.mockResolvedValue([connection]);
    render(<SMTPConnections />);
    expect(await screen.findByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("STARTTLS")).toBeInTheDocument();
    expect(screen.getByText(/smtp.x.com:587/)).toBeInTheDocument();
  });

  it("creates a connection", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([]);
    mockedApi.createSMTPConnection.mockResolvedValue({ id: "s2" });
    render(<SMTPConnections />);
    await screen.findByText("No sending accounts yet");
    await user.click(
      screen.getAllByRole("button", { name: /New connection/i })[0]
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Host"), "smtp.test.com");
    await user.type(within(dialog).getByLabelText("Username"), "u");
    await user.type(within(dialog).getByLabelText("Password"), "p");
    await user.type(within(dialog).getByLabelText("From email"), "x@y.com");
    await user.click(
      within(dialog).getByRole("button", { name: "Test and create" })
    );
    await waitFor(() =>
      expect(mockedApi.createSMTPConnection).toHaveBeenCalled()
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Sending account verified and saved."
    );
  });

  it("edits a connection, sending credentials only when re-entered", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([connection]);
    mockedApi.updateSMTPConnection.mockResolvedValue({ id: "s1" });
    render(<SMTPConnections />);
    await screen.findByText("Primary");
    await user.click(screen.getByLabelText("Edit connection"));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Test and save" })
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
    render(<SMTPConnections />);
    await screen.findByText("Primary");
    await user.click(screen.getByLabelText("Delete connection"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockedApi.deleteSMTPConnection).toHaveBeenCalledWith("s1")
    );
  });

  it("toggles the secure and default checkboxes in the form", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([]);
    render(<SMTPConnections />);
    await screen.findByText("No sending accounts yet");
    await user.click(
      screen.getAllByRole("button", { name: /New connection/i })[0]
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
    render(<SMTPConnections />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("oops"));
  });
});
