import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
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
    // setup health badge: 3 of 4 ready
    expect(screen.getByText("3/4 ready")).toBeInTheDocument();
    expect(screen.getByText("Default: Primary")).toBeInTheDocument();
    // event badge
    expect(screen.getByText("DELIVERED")).toBeInTheDocument();
  });

  it("shows empty states when there are no jobs or events", async () => {
    mockedApi.dashboardSummary.mockResolvedValue({
      ...summary,
      recentEmailJobs: [],
      recentEvents: []
    });
    renderDashboard();
    expect(await screen.findByText("No email jobs yet")).toBeInTheDocument();
    expect(screen.getByText("No events recorded yet")).toBeInTheDocument();
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
