import { renderWithProviders, screen, waitFor, within } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigate };
});

const sessionValue = vi.hoisted(() => ({
  current: {
    user: { id: "u1", email: "me@x.com", name: "Ada" },
    organizations: [
      { id: "o1", name: "Acme" },
      { id: "o2", name: "Beta" }
    ],
    currentOrganizationId: "o1",
    currentOrganization: { id: "o1", name: "Acme" },
    setCurrentOrganizationId: vi.fn(),
    signOut: vi.fn()
  }
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => sessionValue.current
}));

import { DashboardLayout } from "./DashboardLayout.js";

function renderLayout(initial = "/") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route index element={<div>Inbox page</div>} />
          <Route path="inbox" element={<div>Inbox page</div>} />
          <Route path="campaigns" element={<div>Campaigns page</div>} />
          <Route path="campaigns/lists" element={<div>Lists page</div>} />
          <Route path="campaigns/lists/smart" element={<div>Smart page</div>} />
          <Route path="settings" element={<div>Settings page</div>} />
          <Route
            path="settings/sending"
            element={<div>Sending accounts page</div>}
          />
          {/* The one settings destination that kept a top-level path. */}
          <Route
            path="queue-operations"
            element={<div>Background jobs page</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  , { withRouter: false });
}

/** Every class name in a rendered tree, flattened. */
function classNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).flatMap((node) =>
    Array.from(node.classList)
  );
}

describe("DashboardLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionValue.current.setCurrentOrganizationId = vi.fn();
    sessionValue.current.signOut = vi.fn();
    sessionValue.current.currentOrganizationId = "o1";
    sessionValue.current.currentOrganization = { id: "o1", name: "Acme" };
  });

  it("renders the sidebar nav and the routed outlet", () => {
    renderLayout("/");
    expect(screen.getAllByText("Home").length).toBeGreaterThan(0);
    expect(screen.getByText("Inbox page")).toBeInTheDocument();
  });

  it("opens the org switcher and switches organization", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    const trigger = screen.getAllByText("Acme")[0];
    await user.click(trigger);
    const beta = await screen.findByText("Beta");
    await user.click(beta);
    await waitFor(() =>
      expect(sessionValue.current.setCurrentOrganizationId).toHaveBeenCalledWith(
        "o2"
      )
    );
    expect(toast.success).toHaveBeenCalledWith("Switched to Beta.");
  });

  it("signs out from the account menu", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    await user.click(screen.getAllByText("Ada")[0]);
    const signOut = await screen.findByText("Sign out");
    await user.click(signOut);
    expect(sessionValue.current.signOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("renders a sign-in link when not authenticated", () => {
    sessionValue.current = {
      ...sessionValue.current,
      user: undefined,
      organizations: [],
      currentOrganization: undefined
    } as never;
    renderLayout("/");
    expect(screen.getAllByText("Sign in").length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------- §4 nav
  describe("navigation structure (§4)", () => {
    it("shows Settings as a single destination, not an expandable group", () => {
      renderLayout("/");
      // It is a link, and there is no disclosure button that expands it.
      expect(
        screen.getByRole("link", { name: "Settings" })
      ).toHaveAttribute("href", "/settings");
      expect(
        screen.queryByRole("button", { name: /Settings/ })
      ).not.toBeInTheDocument();
    });

    it("keeps Settings active while inside one of its hub destinations", () => {
      renderLayout("/settings/sending");
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
        "aria-current",
        "page"
      );
      // The hub's destinations are no longer sidebar entries of their own.
      expect(
        screen.queryByRole("link", { name: "Sending" })
      ).not.toBeInTheDocument();
    });

    it("keeps Settings active on the one destination that kept its own path", () => {
      // Background jobs never moved under /settings/*, so it is the only entry
      // in the item's `activePaths` — and the only one that could go dark.
      renderLayout("/queue-operations");
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
        "aria-current",
        "page"
      );
    });

    it("merges smart lists into Lists rather than listing it separately", () => {
      renderLayout("/campaigns/lists/smart");
      expect(
        screen.queryByRole("link", { name: "Smart lists" })
      ).not.toBeInTheDocument();
      // Lists stays lit on the Smart tab's route.
      expect(screen.getByRole("link", { name: "Lists" })).toHaveAttribute(
        "aria-current",
        "page"
      );
    });

    it("does not light up Campaigns when the route is a Lists sub-path", () => {
      renderLayout("/campaigns/lists");
      expect(
        screen.getByRole("link", { name: "Campaigns" })
      ).not.toHaveAttribute("aria-current");
    });

    it("treats the index route as the Inbox", () => {
      renderLayout("/");
      const inboxLinks = screen.getAllByRole("link", { name: /Inbox/ });
      expect(
        inboxLinks.some((link) => link.getAttribute("aria-current") === "page")
      ).toBe(true);
    });
  });

  // ------------------------------------------------------------- §5 mobile
  describe("mobile shell (§5)", () => {
    it("renders the five bottom tabs", () => {
      const { container } = renderLayout("/");
      const tabBar = within(
        container.querySelector("nav[aria-label='Primary']") as HTMLElement
      );
      expect(tabBar.getByRole("link", { name: /Home/ })).toBeInTheDocument();
      expect(tabBar.getByRole("link", { name: /Compose/ })).toBeInTheDocument();
      expect(tabBar.getByRole("link", { name: /Inbox/ })).toBeInTheDocument();
      expect(tabBar.getByRole("link", { name: /Contacts/ })).toBeInTheDocument();
      expect(tabBar.getByRole("button", { name: "More" })).toBeInTheDocument();
    });

    it("opens a More sheet listing what the tab bar leaves out", async () => {
      const user = userEvent.setup();
      const { container } = renderLayout("/");
      const tabBar = within(
        container.querySelector("nav[aria-label='Primary']") as HTMLElement
      );
      await user.click(tabBar.getByRole("button", { name: "More" }));

      const sheet = within(await screen.findByRole("dialog"));
      for (const label of [
        "Drafts",
        "Outbox",
        "Lists",
        "Templates",
        "Campaigns",
        "Settings"
      ]) {
        expect(sheet.getByRole("link", { name: label })).toBeInTheDocument();
      }
      // Tab-bar destinations aren't repeated in the sheet.
      expect(sheet.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
      expect(
        sheet.queryByRole("link", { name: "Contacts" })
      ).not.toBeInTheDocument();
    });

    it("closes the More sheet when a destination is chosen", async () => {
      const user = userEvent.setup();
      const { container } = renderLayout("/");
      const tabBar = within(
        container.querySelector("nav[aria-label='Primary']") as HTMLElement
      );
      await user.click(tabBar.getByRole("button", { name: "More" }));
      const sheet = await screen.findByRole("dialog");
      await user.click(within(sheet).getByRole("link", { name: "Settings" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      );
    });
  });

  // ------------------------------------------------------- §2 tablet drawer
  it("opens and closes the tablet navigation drawer", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    await user.click(screen.getByLabelText("Open navigation"));
    const close = await screen.findByLabelText("Close navigation");
    await user.click(close);
    await waitFor(() =>
      expect(screen.queryByLabelText("Close navigation")).not.toBeInTheDocument()
    );
  });

  // ------------------------------------------------- §2 one scroll container
  describe("scroll containment (§2)", () => {
    it("creates no scroll container of its own at any width", () => {
      const { container } = renderLayout("/");
      const scrollers = classNames(container).filter((name) =>
        /^overflow-(x-|y-)?(auto|scroll)$/.test(name)
      );
      expect(scrollers).toEqual([]);
    });

    it("gives the sidebar no scrollbar and no height it could overflow", () => {
      const { container } = renderLayout("/");
      const sidebar = container.querySelector("aside") as HTMLElement;
      expect(sidebar).toBeTruthy();
      // Fixed, so it never participates in the document's scroll…
      expect(sidebar.className).toContain("fixed");
      // …and nothing inside it may scroll instead.
      expect(
        classNames(sidebar).some((name) => name.startsWith("overflow-"))
      ).toBe(false);
    });

    it("holds main to the breakpoint contract the three layouts depend on", () => {
      const { container } = renderLayout("/");
      const main = container.querySelector("main") as HTMLElement;
      const sidebar = container.querySelector("aside") as HTMLElement;
      const tabBar = container.querySelector(
        "nav[aria-label='Primary']"
      ) as HTMLElement;

      // ≥1024px: sidebar visible, main inset by exactly its width.
      expect(sidebar.className).toContain("hidden");
      expect(sidebar.className).toContain("lg:flex");
      expect(sidebar.className).toContain("w-sidebar");
      expect(main.className).toContain("lg:pl-sidebar");

      // <640px: tab bar visible, main padded to clear it and the home indicator.
      expect(tabBar.className).toContain("sm:hidden");
      expect(main.className).toContain("pb-tabbar-safe");

      // Safe-area insets on every edge the shell owns.
      expect(main.className).toContain("pl-safe-l");
      expect(main.className).toContain("pr-safe-r");
      expect(main.className).toContain("pt-safe-t");
      expect(tabBar.className).toContain("pb-safe-b");
    });
  });
});
