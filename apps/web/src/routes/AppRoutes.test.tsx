import { renderWithProviders, screen } from "../test/render.js";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Stub the lazy-loaded pages and layout so we can assert routing without
// pulling in their full dependency trees.
vi.mock("../layouts/DashboardLayout.js", async () => {
  const { Outlet } =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom"
    );
  return {
    DashboardLayout: () => (
      <div data-testid="layout">
        <Outlet />
      </div>
    ),
  };
});
vi.mock("../pages/Dashboard.js", () => ({
  Dashboard: () => <div>Dashboard page</div>,
}));
vi.mock("../pages/Login.js", () => ({
  Login: ({ mode }: { mode: string }) => <div>Login {mode}</div>,
}));
vi.mock("../pages/Legal.js", () => ({
  LegalPage: ({ kind }: { kind: string }) => <div>Legal {kind}</div>,
}));
vi.mock("../pages/EmailStudio.js", () => ({ EmailStudio: () => <div /> }));
vi.mock("../pages/Inbox.js", () => ({ Inbox: () => <div>Inbox page</div> }));
vi.mock("../pages/SMTPConnections.js", () => ({
  SMTPConnections: () => <div />,
}));
vi.mock("../pages/Contacts.js", () => ({ Contacts: () => <div /> }));
vi.mock("../pages/Templates.js", () => ({ Templates: () => <div /> }));
vi.mock("../pages/Campaigns.js", () => ({ Campaigns: () => <div /> }));
vi.mock("../pages/ContactLists.js", () => ({ ContactLists: () => <div /> }));
vi.mock("../pages/CampaignAnalytics.js", () => ({
  CampaignAnalytics: () => <div />,
}));
vi.mock("../pages/Settings.js", () => ({ Settings: () => <div /> }));
vi.mock("../pages/QueueOperations.js", () => ({
  QueueOperations: () => <div>Queue operations</div>,
}));

import { AppRoutes } from "./AppRoutes.js";

describe("AppRoutes", () => {
  // Signing in lands on the inbox now; the stats page moved to /insights.
  it("renders the inbox within the layout at the index route", async () => { renderWithProviders(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>
    , { withRouter: false });
    expect(await screen.findByTestId("layout")).toBeInTheDocument();
    expect(await screen.findByText("Inbox page")).toBeInTheDocument();
  });

  it("renders the login route outside the layout", async () => { renderWithProviders(
      <MemoryRouter initialEntries={["/login"]}>
        <AppRoutes />
      </MemoryRouter>
    , { withRouter: false });
    expect(await screen.findByText("Login login")).toBeInTheDocument();
  });

  it("renders the register route", async () => { renderWithProviders(
      <MemoryRouter initialEntries={["/register"]}>
        <AppRoutes />
      </MemoryRouter>
    , { withRouter: false });
    expect(await screen.findByText("Login register")).toBeInTheDocument();
  });

  it("renders password reset routes outside the layout", async () => { renderWithProviders(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <AppRoutes />
      </MemoryRouter>
    , { withRouter: false });
    expect(await screen.findByText("Login forgot")).toBeInTheDocument();
    expect(screen.queryByTestId("layout")).not.toBeInTheDocument();
  });

  it("renders public legal routes outside the dashboard layout", async () => { renderWithProviders(
      <MemoryRouter initialEntries={["/terms"]}>
        <AppRoutes />
      </MemoryRouter>
    , { withRouter: false });
    expect(await screen.findByText("Legal terms")).toBeInTheDocument();
    expect(screen.queryByTestId("layout")).not.toBeInTheDocument();
  });
});
