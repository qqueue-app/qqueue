import { renderWithProviders, screen, waitFor } from "../test/render.js";
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
          <Route
            path="smtp-connections"
            element={<div>Sending accounts page</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  , { withRouter: false });
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
    // The nav is flat now — every destination is visible without expanding a
    // group. Labels appear in both the sidebar and the mobile More sheet.
    expect(screen.getAllByText("Inbox").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Compose").length).toBeGreaterThan(0);
    expect(screen.getByText("Inbox page")).toBeInTheDocument();
  });

  it("shows setup destinations without needing to expand a group", () => {
    renderLayout("/smtp-connections");
    expect(screen.getAllByText("Sending accounts").length).toBeGreaterThan(0);
    expect(screen.getByText("Sending accounts page")).toBeInTheDocument();
  });

  it("opens the org switcher and switches organization", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    // org switcher trigger shows the current org name
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

  it("opens the mobile More sheet", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    // Navigation on a phone lives in a bottom bar; everything that doesn't fit
    // is behind More.
    await user.click(screen.getByRole("button", { name: "More sections" }));
    expect(await screen.findByText("Everything else")).toBeInTheDocument();
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
});
