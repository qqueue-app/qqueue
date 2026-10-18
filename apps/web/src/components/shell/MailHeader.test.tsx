import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../../test/render.js";
import { MailHeader } from "./MailHeader.js";
import { api } from "../../lib/api.js";
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => ({ user: { id: "u1" }, currentOrganizationId: "o1" }),
}));
vi.mock("./AccountMenu.js", () => ({
  AccountMenu: () => <button>Account</button>,
}));
vi.mock("../../lib/api.js", () => ({ api: { searchableMailboxes: vi.fn() } }));
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function renderHeader(route = "/inbox") {
  return renderWithProviders(
    <>
      <MailHeader onMenu={vi.fn()} />
      <Location />
    </>,
    { route }
  );
}
beforeEach(() => {
  vi.mocked(api.searchableMailboxes)
    .mockReset()
    .mockResolvedValue([{ email: "team@example.test", name: "Team" }]);
});
describe("persistent mail search and shortcuts", () => {
  it("focuses search with slash, preserves mailbox scope and leaves typing alone", async () => {
    const user = userEvent.setup();
    renderHeader("/inbox?address=team%40example.test");
    await user.keyboard("/");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await user.type(screen.getByRole("searchbox"), "receipt");
    expect(screen.getByTestId("location")).toHaveTextContent("/inbox");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/search?q=receipt&address=team%40example.test"
    );
    await user.click(screen.getByRole("button", { name: "Clear mail search" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
  it("searches a selected scope and assigned mailbox through the actual URL contract", async () => {
    const user = userEvent.setup();
    renderHeader();
    expect(api.searchableMailboxes).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Search options" }));
    await screen.findByRole("option", { name: "team@example.test" });
    await user.selectOptions(screen.getByLabelText("Look in"), "SENT");
    await user.selectOptions(
      screen.getByLabelText("Mailbox"),
      "team@example.test"
    );
    await user.click(
      screen.getByRole("button", { name: "Search", exact: true })
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/search?address=team%40example.test&scope=SENT"
    );
  });
  it("offers retry for mailbox choices and safely retains an unavailable URL filter", async () => {
    vi.mocked(api.searchableMailboxes).mockRejectedValueOnce(
      new Error("offline")
    );
    const user = userEvent.setup();
    renderHeader("/search?address=old%40example.test&scope=RECEIVED");
    await user.click(screen.getByRole("button", { name: "Search options" }));
    expect(
      await screen.findByRole("option", {
        name: "old@example.test (unavailable)",
      })
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(api.searchableMailboxes).toHaveBeenCalledTimes(2)
    );
    await screen.findByRole("option", { name: "team@example.test" });
  });
  it("opens help and compose from the keyboard without intercepting editor input", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.keyboard("?");
    expect(
      await screen.findByRole("dialog", { name: "Keyboard shortcuts" })
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(document.body);
    await user.keyboard("c");
    expect(screen.getByTestId("location")).toHaveTextContent("/email-studio");
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("c");
    expect(screen.getByRole("searchbox")).toHaveValue("c");
  });
});
