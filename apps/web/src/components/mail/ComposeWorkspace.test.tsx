import { useState } from "react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  type SetURLSearchParams,
} from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  screen,
  within,
  waitFor,
} from "../../test/render.js";
import { DashboardLayout } from "../../layouts/DashboardLayout.js";
vi.mock("../../lib/use-unread-count.js", () => ({ useUnreadCount: () => 0 }));
import {
  ComposeHost,
  MailComposeProvider,
  useMailRouteLocation,
} from "./ComposeWorkspace.js";
const actor = vi.hoisted(() => ({
  user: { id: "u1" },
  currentOrganizationId: "o1",
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => ({
    ...actor,
    organizations: [],
    currentOrganization: { id: actor.currentOrganizationId, name: "Preview" },
  }),
}));
vi.mock("../../pages/EmailStudio.js", () => ({
  EmailStudio: ({
    queryState,
  }: {
    queryState: [URLSearchParams, SetURLSearchParams];
  }) => {
    const [text, setText] = useState("");
    return (
      <>
        <textarea
          aria-label="Writing"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span>Draft identity: {queryState[0].get("draft") || "new"}</span>
        <button onClick={() => queryState[1]({ draft: "saved-1" })}>
          Save identity
        </button>
      </>
    );
  },
}));
function RoutesUnderTest() {
  const location = useMailRouteLocation();
  return (
    <>
      <nav>
        <Link to="/email-studio">Compose</Link>
        <Link to="/sent?q=client">Sent</Link>
        <Link to="/email-studio?draft=linked">Open saved draft</Link>
      </nav>
      <Routes location={location}>
        <Route path="/inbox" element={<h1>Inbox list</h1>} />
        <Route path="/sent" element={<h1>Sent list</h1>} />
      </Routes>
      <ComposeHost />
    </>
  );
}
function Harness() {
  return (
    <MemoryRouter initialEntries={["/inbox?q=receipt"]}>
      <MailComposeProvider>
        <RoutesUnderTest />
      </MailComposeProvider>
    </MemoryRouter>
  );
}
describe("persistent compose workspace", () => {
  it("keeps writing through mail navigation, minimize, close and reopen without leaking mail query state", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { withRouter: false });
    await user.click(screen.getByText("Compose"));
    await user.type(
      await screen.findByRole("textbox", { name: "Writing" }),
      "Unsaved important reply"
    );
    await user.click(screen.getByText("Save identity"));
    expect(
      screen.getByRole("heading", { name: "Inbox list" })
    ).toBeInTheDocument();
    await user.click(screen.getByText("Sent"));
    expect(
      screen.getByRole("heading", { name: "Sent list" })
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Writing" })).toHaveValue(
      "Unsaved important reply"
    );
    expect(screen.getByText("Draft identity: saved-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Minimize compose" }));
    expect(
      screen.queryByRole("textbox", { name: "Writing" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore compose" }));
    await user.click(screen.getByRole("button", { name: "Expand compose" }));
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    await user.click(
      screen.getByRole("button", { name: "Close and keep draft" })
    );
    expect(
      screen.queryByRole("textbox", { name: "Writing" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByText("Compose"));
    expect(await screen.findByRole("textbox", { name: "Writing" })).toHaveValue(
      "Unsaved important reply"
    );
    await user.click(screen.getByText("Open saved draft"));
    expect(
      await screen.findByText("Draft identity: linked")
    ).toBeInTheDocument();
  });
  it("does not carry an open writer into another organization", async () => {
    const user = userEvent.setup();
    actor.currentOrganizationId = "o1";
    const view = renderWithProviders(<Harness />, { withRouter: false });
    await user.click(screen.getByText("Compose"));
    await user.type(
      await screen.findByRole("textbox", { name: "Writing" }),
      "Private organization writing"
    );
    await user.click(screen.getByText("Sent"));
    actor.currentOrganizationId = "o2";
    view.rerender(<Harness />);
    expect(
      screen.queryByRole("textbox", { name: "Writing" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByText("Compose"));
    expect(await screen.findByRole("textbox", { name: "Writing" })).toHaveValue(
      ""
    );
    actor.currentOrganizationId = "o1";
  });
});

it("contains phone focus in compose and restores the mailbox after Escape without discarding text", async () => {
  const realMedia = window.matchMedia;
  const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    ...realMedia(query),
    matches: query.includes("max-width"),
  }));
  const rects = vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList);
  actor.currentOrganizationId = "o1";
  const user = userEvent.setup();
  const view = renderWithProviders(<Harness />, { withRouter: false });
  try {
    await user.click(screen.getByText("Compose"));
    const writer = await screen.findByRole("textbox", { name: "Writing" });
    await user.type(writer, "Phone draft");
    const modal = screen.getByRole("dialog", { name: "Compose workspace" });
    expect(modal).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Compose").closest("nav")).toHaveAttribute("inert");
    screen.getByRole("button", { name: "New message" }).focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Save identity" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "New message" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Compose workspace" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Compose").closest("nav")).not.toHaveAttribute(
      "inert"
    );
    await user.click(screen.getByText("Compose"));
    expect(await screen.findByRole("textbox", { name: "Writing" })).toHaveValue(
      "Phone draft"
    );
  } finally {
    view.unmount();
    media.mockRestore();
    rects.mockRestore();
  }
});

function PhoneRoutes() {
  const location = useMailRouteLocation();
  return (
    <Routes location={location}>
      <Route element={<DashboardLayout />}>
        <Route path="/inbox" element={<p>Phone inbox</p>} />
      </Route>
    </Routes>
  );
}
it("closes the phone folder drawer before opening the persistent composer", async () => {
  const realMedia = window.matchMedia;
  const media = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) => ({
      ...realMedia(query),
      matches: query.includes("max-width"),
    }));
  const user = userEvent.setup();
  const view = renderWithProviders(
    <MemoryRouter initialEntries={["/inbox"]}>
      <MailComposeProvider>
        <PhoneRoutes />
      </MailComposeProvider>
    </MemoryRouter>,
    { withRouter: false }
  );
  try {
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    await user.click(within(drawer).getByRole("link", { name: "Compose" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Navigation" })
      ).not.toBeInTheDocument()
    );
    expect(
      await screen.findByRole("dialog", { name: "Compose workspace" })
    ).toBeInTheDocument();
    await user.type(
      await screen.findByRole("textbox", { name: "Writing" }),
      "Reply from the phone drawer"
    );
    expect(screen.getByRole("textbox", { name: "Writing" })).toHaveValue(
      "Reply from the phone drawer"
    );
  } finally {
    view.unmount();
    media.mockRestore();
  }
});
