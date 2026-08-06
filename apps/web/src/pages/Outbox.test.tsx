import { renderWithProviders, screen, waitFor } from "../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: { listOutbox: vi.fn(), cancelOutboxEmail: vi.fn() }
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" })
}));

import { api } from "../lib/api.js";
import { Outbox } from "./Outbox.js";

const mockedApi = api as unknown as {
  listOutbox: ReturnType<typeof vi.fn>;
  cancelOutboxEmail: ReturnType<typeof vi.fn>;
};

const scheduled = {
  id: "job_1",
  subject: "Friday update",
  to: ["a@x.com"],
  ccCount: 1,
  bccCount: 0,
  status: "QUEUED" as const,
  origin: "MANUAL" as const,
  scheduledAt: "2026-07-24T09:00:00.000Z",
  createdAt: "2026-07-21T09:00:00.000Z",
  campaignName: null,
  sendingAccount: {
    name: "Primary",
    fromEmail: "hi@acme.com",
    fromName: "Acme"
  }
};

describe("Outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listOutbox.mockResolvedValue([scheduled]);
    mockedApi.cancelOutboxEmail.mockResolvedValue({
      id: "job_1",
      status: "CANCELLED"
    });
  });

  it("shows what is queued and which account it sends from", async () => { renderWithProviders(<Outbox />);

    expect(await screen.findByText("Friday update")).toBeInTheDocument();
    expect(screen.getByText("Acme <hi@acme.com>")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    // The one Cc is counted, not listed.
    expect(screen.getByText("a@x.com +1 more")).toBeInTheDocument();
  });

  it("labels a campaign batch with its campaign", async () => {
    mockedApi.listOutbox.mockResolvedValue([
      {
        ...scheduled,
        origin: "CAMPAIGN",
        campaignName: "July newsletter",
        scheduledAt: null
      }
    ]);
    renderWithProviders(<Outbox />);

    expect(await screen.findByText("Campaign")).toBeInTheDocument();
    expect(screen.getByText("July newsletter")).toBeInTheDocument();
    expect(screen.getByText("As soon as possible")).toBeInTheDocument();
  });

  it("cancels a queued email after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Outbox />);
    await screen.findByText("Friday update");

    await user.click(screen.getByRole("button", { name: /^Cancel this email$/ }));
    await user.click(screen.getByRole("button", { name: "Cancel email" }));

    await waitFor(() =>
      expect(mockedApi.cancelOutboxEmail).toHaveBeenCalledWith(
        "job_1",
        "org_1"
      )
    );
    // The list re-reads from the server rather than dropping the row locally:
    // the API is the authority on what is still queued, and guessing wrong
    // would hide mail that is in fact still going out.
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Cancelled — that email won't be sent."
      )
    );
  });

  it("offers no cancel once the worker has picked the email up", async () => {
    mockedApi.listOutbox.mockResolvedValue([
      { ...scheduled, status: "PROCESSING" }
    ]);
    renderWithProviders(<Outbox />);

    expect(await screen.findByText("Sending now")).toBeInTheDocument();
    expect(screen.getByText("Too late")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Cancel this email$/ })
    ).not.toBeInTheDocument();
  });

  it("reloads when a cancel loses the race with the sender", async () => {
    const user = userEvent.setup();
    mockedApi.cancelOutboxEmail.mockRejectedValue(
      new Error("This email has already been sent")
    );
    renderWithProviders(<Outbox />);
    await screen.findByText("Friday update");

    await user.click(screen.getByRole("button", { name: /^Cancel this email$/ }));
    await user.click(screen.getByRole("button", { name: "Cancel email" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This email has already been sent"
      )
    );
    // The list is refreshed rather than optimistically pruned.
    expect(mockedApi.listOutbox).toHaveBeenCalledTimes(2);
  });

  it("says so plainly when nothing is waiting", async () => {
    mockedApi.listOutbox.mockResolvedValue([]);
    renderWithProviders(<Outbox />);

    expect(
      await screen.findByText("Nothing waiting to send")
    ).toBeInTheDocument();
  });
});
