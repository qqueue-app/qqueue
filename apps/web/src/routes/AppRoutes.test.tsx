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
  SMTPConnections: () => <div>Sending settings</div>,
}));
vi.mock("../pages/Contacts.js", () => ({ Contacts: () => <div /> }));
vi.mock("../pages/Templates.js", () => ({ Templates: () => <div /> }));
vi.mock("../pages/Campaigns.js", () => ({ Campaigns: () => <div /> }));
vi.mock("../pages/ContactLists.js", () => ({ ContactLists: () => <div /> }));
vi.mock("../pages/CampaignAnalytics.js", () => ({
  CampaignAnalytics: () => <div />,
}));
vi.mock("../pages/settings/SettingsHub.js", () => ({
  SettingsHub: () => <div>Settings hub</div>,
}));
vi.mock("../pages/settings/OrganizationSettings.js", () => ({
  OrganizationSettings: () => <div>Organization settings</div>,
}));
vi.mock("../pages/settings/TeamSettings.js", () => ({
  TeamSettings: () => <div />,
}));
vi.mock("../pages/settings/ApiSettings.js", () => ({
  ApiSettings: () => <div>API settings</div>,
}));
vi.mock("../pages/settings/InstanceSettings.js", () => ({
  InstanceSettings: () => <div />,
}));
vi.mock("../pages/settings/AccountSettings.js", () => ({
  AccountSettings: () => <div>Account settings</div>,
}));
vi.mock("../pages/Suppressions.js", () => ({
  Suppressions: () => <div>Suppressions page</div>,
}));
vi.mock("../pages/Mailboxes.js", () => ({ Mailboxes: () => <div /> }));
vi.mock("../pages/Deliverability.js", () => ({
  Deliverability: () => <div />,
}));
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

  // ------------------------------------------------------------- settings §4
  it("serves the hub at /settings, not a mega-page", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings"]}>
        <AppRoutes />
      </MemoryRouter>,
      { withRouter: false }
    );
    expect(await screen.findByText("Settings hub")).toBeInTheDocument();
  });

  it.each([
    ["/settings/organization", "Organization settings"],
    ["/settings/sending", "Sending settings"],
    ["/settings/suppressions", "Suppressions page"],
    ["/settings/api", "API settings"],
    ["/settings/account", "Account settings"],
  ])("routes %s to its own page", async (path, text) => {
    renderWithProviders(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
      { withRouter: false }
    );
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  /*
    These four are where the pages used to live. Bookmarks and every docs link
    written before the move still have to land somewhere real — a redirect is
    cheap, a 404 is not.
  */
  it.each([
    ["/smtp-connections", "Sending settings"],
    ["/suppressions", "Suppressions page"],
  ])("redirects the old path %s to its new home", async (path, text) => {
    renderWithProviders(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
      { withRouter: false }
    );
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
