import { renderWithProviders, screen } from "../test/render.js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Force the mobile branch of `useIsMobile`. The shared setup stubs matchMedia
 * to match nothing, which is what makes every other page test render desktop.
 */
function useMobileViewport() {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width: 639.98px"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({
  current: { currentOrganizationId: "org_1" },
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current,
}));

vi.mock("../lib/api.js", () => ({
  api: { dashboardSummary: vi.fn() },
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
    processingEmails: 0,
  },
  setup: {
    hasSmtpConnection: true,
    hasDefaultSmtp: true,
    hasContacts: true,
    hasTemplates: false,
  },
  defaultSmtpConnection: {
    id: "s1",
    name: "Primary",
    host: "smtp.x",
    fromEmail: "a@b.com",
  },
  recentEmailJobs: [
    {
      id: "j1",
      toEmail: "to@x.com",
      subject: "Hello",
      status: "SENT",
      smtpConnectionName: "Primary",
      createdAt: "2026-01-01T10:00:00Z",
      sentAt: "2026-01-01T10:01:00Z",
    },
  ],
  recentEvents: [],
};

let restore: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  restore = useMobileViewport();
  mockedApi.dashboardSummary.mockResolvedValue(summary);
});

afterEach(() => restore());

function renderDashboard() {
  return renderWithProviders(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
    { withRouter: false }
  );
}

describe("Dashboard on a phone", () => {
  it("renders recent jobs as stacked cards, never a table", async () => {
    renderDashboard();
    await screen.findByText("Default: Primary");

    // §5: tables don't shrink, they transform. A horizontally scrolling data
    // table is ruled out twice over, so the <table> must not exist at all —
    // not merely be hidden, which would leave every row in the accessibility
    // tree a second time.
    expect(
      screen.queryByRole("table", { name: "Recent email jobs" })
    ).not.toBeInTheDocument();

    // The row's content is all still there, as a card.
    expect(screen.getByText("to@x.com")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("collapses the header's two actions into one ⋯ menu", async () => {
    renderDashboard();
    await screen.findByText("Default: Primary");

    expect(
      screen.getByRole("button", { name: "More actions" })
    ).toBeInTheDocument();
    // Neither action sits in the 48px title row as its own button.
    expect(
      screen.queryByRole("link", { name: "Send email" })
    ).not.toBeInTheDocument();
  });

  it("gives every setup-step button a 44px hit area", async () => {
    renderDashboard();
    const step = await screen.findByRole("link", { name: "Create a template" });

    // The control keeps its 32px visual height and grows an invisible 44px
    // pseudo-element under the thumb — padding alone cannot deliver both.
    expect(step.className).toContain("after:h-touch");
    expect(step.className).toContain("sm:after:hidden");
  });
});
