import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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
import { ThemeProvider } from "../lib/theme.js";

function renderLayout(initial = "/") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route index element={<div>Home page</div>} />
            <Route path="campaigns" element={<div>Campaigns page</div>} />
            <Route path="campaigns/lists" element={<div>Lists page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
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
    // nav labels appear (desktop + mobile sidebars both render)
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("expands the campaigns group and shows children when on a child route", () => {
    renderLayout("/campaigns/lists");
    expect(screen.getAllByText("All campaigns").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contact lists").length).toBeGreaterThan(0);
    expect(screen.getByText("Lists page")).toBeInTheDocument();
  });

  it("toggles the campaigns nav group on click", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    // groups collapsed initially on "/"; click to expand
    const campaignsButtons = screen.getAllByRole("button", {
      name: /Campaigns/
    });
    await user.click(campaignsButtons[0]);
    expect(screen.getAllByText("All campaigns").length).toBeGreaterThan(0);
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

  it("opens and closes the mobile drawer", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    await user.click(screen.getByLabelText("Open navigation"));
    const close = await screen.findByLabelText("Close navigation");
    await user.click(close);
    await waitFor(() =>
      expect(screen.queryByLabelText("Close navigation")).not.toBeInTheDocument()
    );
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
