import { renderWithProviders, screen, waitFor, within } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

const session = vi.hoisted(() => ({
  current: { currentOrganizationId: "org_1" }
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current
}));

vi.mock("../lib/api.js", () => ({
  api: {
    listRecurringSends: vi.fn(),
    pauseRecurringSend: vi.fn(),
    resumeRecurringSend: vi.fn(),
    deleteRecurringSend: vi.fn()
  }
}));

import { RecurringSends } from "./RecurringSends.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const sends = [
  {
    id: "rs_1",
    organizationId: "org_1",
    name: "Weekly digest",
    subject: "This week at Acme",
    // 09:00 every Monday.
    cronExpression: "0 9 * * 1",
    timezone: "Europe/London",
    status: "ACTIVE" as const,
    nextRunAt: "2026-08-10T08:00:00.000Z",
    lastRunAt: null,
    createdAt: "2026-08-01T00:00:00.000Z"
  },
  {
    id: "rs_2",
    organizationId: "org_1",
    name: "Monthly invoice reminder",
    subject: "Your invoice",
    cronExpression: "0 9 1 * *",
    timezone: "UTC",
    status: "PAUSED" as const,
    nextRunAt: null,
    lastRunAt: null,
    createdAt: "2026-07-01T00:00:00.000Z"
  }
];

function renderPage() {
  return renderWithProviders(<RecurringSends />);
}

describe("RecurringSends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = { currentOrganizationId: "org_1" };
    mockedApi.listRecurringSends.mockResolvedValue(sends);
  });

  it("lists every schedule with its cadence and status", async () => {
    renderPage();

    expect(await screen.findByText("Weekly digest")).toBeInTheDocument();
    // The cron is rendered in words, not as five fields of syntax.
    expect(screen.getByText(/At 09:00 AM, only on Monday/i)).toBeInTheDocument();
    expect(screen.getByText("Monthly invoice reminder")).toBeInTheDocument();

    const active = screen.getByRole("row", { name: /Weekly digest/i });
    expect(within(active).getByText("Active")).toBeInTheDocument();
    const paused = screen.getByRole("row", { name: /Monthly invoice reminder/i });
    expect(within(paused).getByText("Paused")).toBeInTheDocument();
  });

  // A paused schedule's stored nextRunAt is a date the worker will never act
  // on; printing it would be a lie the table tells every time you look at it.
  it("shows no next run for a paused schedule", async () => {
    renderPage();
    await screen.findByText("Monthly invoice reminder");

    const paused = screen.getByRole("row", { name: /Monthly invoice reminder/i });
    expect(within(paused).getByText("—")).toBeInTheDocument();
    // The active one still names its next run.
    const active = screen.getByRole("row", { name: /Weekly digest/i });
    expect(within(active).queryByText("—")).not.toBeInTheDocument();
  });

  it("pauses an active schedule", async () => {
    const user = userEvent.setup();
    mockedApi.pauseRecurringSend.mockResolvedValue({
      ...sends[0],
      status: "PAUSED"
    });
    renderPage();
    await screen.findByText("Weekly digest");

    await user.click(
      screen.getByRole("button", { name: /Pause this schedule/i })
    );

    await waitFor(() =>
      expect(mockedApi.pauseRecurringSend).toHaveBeenCalledWith("rs_1")
    );
    expect(toast.success).toHaveBeenCalledWith("Recurring send paused.");
  });

  it("resumes a paused schedule", async () => {
    const user = userEvent.setup();
    mockedApi.resumeRecurringSend.mockResolvedValue({
      ...sends[1],
      status: "ACTIVE"
    });
    renderPage();
    await screen.findByText("Monthly invoice reminder");

    await user.click(
      screen.getByRole("button", { name: /Resume this schedule/i })
    );

    await waitFor(() =>
      expect(mockedApi.resumeRecurringSend).toHaveBeenCalledWith("rs_2")
    );
    expect(toast.success).toHaveBeenCalledWith("Recurring send resumed.");
  });

  it("confirms before deleting a schedule", async () => {
    const user = userEvent.setup();
    mockedApi.deleteRecurringSend.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("Weekly digest");

    await user.click(
      screen.getByRole("button", { name: /More actions for Weekly digest/i })
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Delete this schedule/i })
    );

    // Nothing is destroyed until the confirmation is accepted.
    expect(mockedApi.deleteRecurringSend).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mockedApi.deleteRecurringSend).toHaveBeenCalledWith("rs_1")
    );
  });

  it("points an empty organization at the composer", async () => {
    mockedApi.listRecurringSends.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("No recurring sends yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Compose one/i })
    ).toBeInTheDocument();
  });
});
