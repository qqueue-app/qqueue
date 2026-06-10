import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Stub the lazy-loaded pages and layout so we can assert routing without
// pulling in their full dependency trees.
vi.mock("../layouts/DashboardLayout.js", async () => {
  const { Outlet } = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { DashboardLayout: () => <div data-testid="layout"><Outlet /></div> };
});
vi.mock("../pages/Dashboard.js", () => ({
  Dashboard: () => <div>Dashboard page</div>
}));
vi.mock("../pages/Login.js", () => ({
  Login: ({ mode }: { mode: string }) => <div>Login {mode}</div>
}));
vi.mock("../pages/SendEmail.js", () => ({ SendEmail: () => <div /> }));
vi.mock("../pages/SMTPConnections.js", () => ({
  SMTPConnections: () => <div />
}));
vi.mock("../pages/Contacts.js", () => ({ Contacts: () => <div /> }));
vi.mock("../pages/Templates.js", () => ({ Templates: () => <div /> }));
vi.mock("../pages/Campaigns.js", () => ({ Campaigns: () => <div /> }));
vi.mock("../pages/ContactLists.js", () => ({ ContactLists: () => <div /> }));
vi.mock("../pages/CampaignAnalytics.js", () => ({
  CampaignAnalytics: () => <div />
}));
vi.mock("../pages/Settings.js", () => ({ Settings: () => <div /> }));

import { AppRoutes } from "./AppRoutes.js";

describe("AppRoutes", () => {
  it("renders the dashboard within the layout at the index route", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("layout")).toBeInTheDocument();
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("renders the login route outside the layout", async () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(await screen.findByText("Login login")).toBeInTheDocument();
  });

  it("renders the register route", async () => {
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <AppRoutes />
      </MemoryRouter>
    );
    expect(await screen.findByText("Login register")).toBeInTheDocument();
  });
});
