import { cleanup, renderWithProviders, screen, waitFor } from "../test/render.js";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({ current: { currentOrganizationId: "org_1" } }));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current
}));

vi.mock("../lib/api.js", () => ({
  api: { dashboardSummary: vi.fn() }
}));

import { Dashboard } from "./Dashboard.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as {
  dashboardSummary: ReturnType<typeof vi.fn>;
};

const summary = {
  counts: {
    smtpConnections: 2,
    contacts: 10,
    templates: 3,
    emailsToday: 5,
    failedToday: 1,
    processingEmails: 0
  },
  setup: {
    hasSmtpConnection: true,
    hasDefaultSmtp: true,
    hasContacts: true,
    hasTemplates: false
  },
  defaultSmtpConnection: {
    id: "s1",
    name: "Primary",
    host: "smtp.x",
    fromEmail: "a@b.com"
  },
  recentEmailJobs: [
    {
      id: "j1",
      toEmail: "to@x.com",
      subject: "Hello",
      status: "SENT",
      smtpConnectionName: "Primary",
      createdAt: "2026-01-01T10:00:00Z",
      sentAt: "2026-01-01T10:01:00Z"
    }
  ],
  recentEvents: [
    {
      id: "e1",
      type: "DELIVERED",
      occurredAt: "2026-01-01T10:02:00Z",
      emailJob: { toEmail: "to@x.com", subject: "Hello" }
    }
  ]
};

function renderDashboard() {
  return renderWithProviders(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  , { withRouter: false });
}

/**
 * The stat card's value node, found through its label — the numbers themselves
 * repeat across the grid (two cards can both read 0), so the label is the only
 * stable way in.
 */
function failedCardValue() {
  return screen
    .getByText("Failed today")
    .parentElement?.querySelector("[data-numeric]");
}

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
  });

  it("loads and shows the summary data", async () => {
    mockedApi.dashboardSummary.mockResolvedValue(summary);
    renderDashboard();
    expect((await screen.findAllByText("to@x.com")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hello").length).toBeGreaterThan(0);
    // the compact setup checklist: 3 of 4 ready
    expect(screen.getByText("3/4 ready")).toBeInTheDocument();
    expect(screen.getByText("Default: Primary")).toBeInTheDocument();
  });

  it("lists only the setup steps still outstanding", async () => {
    mockedApi.dashboardSummary.mockResolvedValue(summary);
    renderDashboard();
    // The one missing piece is a link to where you fix it...
    expect(
      await screen.findByRole("link", { name: "Create a template" })
    ).toHaveAttribute("href", "/templates");
    // ...and the three already done say nothing at all.
    expect(
      screen.queryByRole("link", { name: "Add a sending account" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Add contacts" })
    ).not.toBeInTheDocument();
  });

  it("drops the setup checklist entirely once every step is ready", async () => {
    mockedApi.dashboardSummary.mockResolvedValue({
      ...summary,
      setup: {
        hasSmtpConnection: true,
        hasDefaultSmtp: true,
        hasContacts: true,
        hasTemplates: true
      }
    });
    renderDashboard();
    await screen.findByText("Default: Primary");
    expect(screen.queryByText("4/4 ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Still to set up:")).not.toBeInTheDocument();
  });

  it("reddens the failed count, and only when something has failed", async () => {
    mockedApi.dashboardSummary.mockResolvedValue(summary);
    renderDashboard();
    await screen.findByText("Default: Primary");
    expect(failedCardValue()).toHaveTextContent("1");
    expect(failedCardValue()).toHaveClass("text-err");
    expect(screen.getByText("Needs attention")).toBeInTheDocument();

    cleanup();
    mockedApi.dashboardSummary.mockResolvedValue({
      ...summary,
      counts: { ...summary.counts, failedToday: 0 }
    });
    renderDashboard();
    expect(await screen.findByText("Nothing failed today")).toBeInTheDocument();
    expect(failedCardValue()).toHaveTextContent("0");
    expect(failedCardValue()).not.toHaveClass("text-err");
  });

  it("humanises job statuses rather than showing the raw enum", async () => {
    mockedApi.dashboardSummary.mockResolvedValue(summary);
    renderDashboard();
    expect(await screen.findByText("Sent")).toBeInTheDocument();
    expect(screen.queryByText("SENT")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no jobs", async () => {
    mockedApi.dashboardSummary.mockResolvedValue({
      ...summary,
      recentEmailJobs: []
    });
    renderDashboard();
    expect(await screen.findByText("No email jobs yet")).toBeInTheDocument();
  });

  it("shows the first-run guide and hides setup health until an email is sent", async () => {
    mockedApi.dashboardSummary.mockResolvedValue({
      ...summary,
      recentEmailJobs: []
    });
    renderDashboard();
    expect(
      await screen.findByText("Connect a sending account")
    ).toBeInTheDocument();
    // the guide replaces the setup checklist for brand-new orgs
    expect(screen.queryByText("Still to set up:")).not.toBeInTheDocument();
  });

  it("hides the first-run guide once an email has been sent", async () => {
    mockedApi.dashboardSummary.mockResolvedValue(summary);
    renderDashboard();
    await screen.findByText("3/4 ready");
    expect(
      screen.queryByText("Connect a sending account")
    ).not.toBeInTheDocument();
  });

  it("shows the no-organization alert and skips the API call", async () => {
    session.current = { currentOrganizationId: undefined } as never;
    renderDashboard();
    expect(
      await screen.findByText("No organization selected")
    ).toBeInTheDocument();
    expect(mockedApi.dashboardSummary).not.toHaveBeenCalled();
  });

  it("toasts on a load failure", async () => {
    mockedApi.dashboardSummary.mockRejectedValue(new Error("boom"));
    renderDashboard();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
  });
});
