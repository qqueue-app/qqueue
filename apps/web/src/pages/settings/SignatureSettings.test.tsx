import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { api } from "../../lib/api.js";
import { SignatureSettings } from "./SignatureSettings.js";
vi.mock("../../lib/api.js", () => ({
  api: { listMailSignatures: vi.fn(), saveMailSignature: vi.fn() },
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => ({ user: { id: "u1" }, currentOrganizationId: "org1" }),
}));
const account = {
  smtpConnectionId: "s1",
  fromEmail: "support@example.com",
  fromName: "Support",
  isDefault: true,
  text: "Old signature",
  enabled: true,
  revision: 2,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listMailSignatures).mockResolvedValue([account]);
  vi.mocked(api.saveMailSignature).mockResolvedValue({
    text: "New signature",
    enabled: true,
    revision: 3,
    smtpConnectionId: "s1",
  });
});
describe("signature settings", () => {
  it("saves a personal signature with its revision and automatic preference", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignatureSettings />);
    const editor = await screen.findByRole("textbox", { name: "Signature" });
    await user.clear(editor);
    await user.type(editor, "New signature");
    await user.click(screen.getByRole("button", { name: "Save signature" }));
    await waitFor(() =>
      expect(api.saveMailSignature).toHaveBeenCalledWith("org1", {
        smtpConnectionId: "s1",
        text: "New signature",
        enabled: true,
        expectedRevision: 2,
      })
    );
  });
  it("keeps local text after a conflict and explicitly loads the saved version", async () => {
    vi.mocked(api.saveMailSignature).mockRejectedValue(new Error("conflict"));
    const user = userEvent.setup();
    renderWithProviders(<SignatureSettings />);
    const editor = await screen.findByRole("textbox", { name: "Signature" });
    await user.clear(editor);
    await user.type(editor, "My unsaved version");
    await user.click(screen.getByRole("button", { name: "Save signature" }));
    await screen.findByText(/Couldn't save this signature/);
    expect(editor).toHaveValue("My unsaved version");
    vi.mocked(api.listMailSignatures).mockResolvedValue([
      { ...account, revision: 3, text: "Other device" },
    ]);
    await user.click(
      screen.getByRole("button", { name: "Reload saved versions" })
    );
    await screen.findByText("Last loaded version: Other device");
    expect(editor).toHaveValue("My unsaved version");
    await user.click(
      screen.getByRole("button", { name: "Use saved signature" })
    );
    expect(editor).toHaveValue("Other device");
  });
  it("explains missing grants without showing another person's signatures", async () => {
    vi.mocked(api.listMailSignatures).mockResolvedValue([]);
    renderWithProviders(<SignatureSettings />);
    expect(
      await screen.findByText(/No sending accounts are assigned/)
    ).toBeInTheDocument();
  });
  it("recovers a failed initial load", async () => {
    vi.mocked(api.listMailSignatures)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([account]);
    const user = userEvent.setup();
    renderWithProviders(<SignatureSettings />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("textbox", { name: "Signature" })
    ).toHaveValue("Old signature");
  });
});
