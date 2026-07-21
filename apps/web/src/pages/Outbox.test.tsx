import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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

  it("shows what is queued and which account it sends from", async () => {
    render(<Outbox />);

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
    render(<Outbox />);

    expect(await screen.findByText("Campaign")).toBeInTheDocument();
    expect(screen.getByText("July newsletter")).toBeInTheDocument();
    expect(screen.getByText("As soon as possible")).toBeInTheDocument();
  });

  it("cancels a queued email after confirmation", async () => {
    const user = userEvent.setup();
    render(<Outbox />);
    await screen.findByText("Friday update");

    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    await user.click(screen.getByRole("button", { name: "Cancel email" }));

    await waitFor(() =>
      expect(mockedApi.cancelOutboxEmail).toHaveBeenCalledWith(
        "job_1",
        "org_1"
      )
    );
    expect(screen.queryByText("Friday update")).not.toBeInTheDocument();
  });

  it("offers no cancel once the worker has picked the email up", async () => {
    mockedApi.listOutbox.mockResolvedValue([
      { ...scheduled, status: "PROCESSING" }
    ]);
    render(<Outbox />);

    expect(await screen.findByText("Sending now")).toBeInTheDocument();
    expect(screen.getByText("Too late to cancel")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Cancel$/ })
    ).not.toBeInTheDocument();
  });

  it("reloads when a cancel loses the race with the sender", async () => {
    const user = userEvent.setup();
    mockedApi.cancelOutboxEmail.mockRejectedValue(
      new Error("This email has already been sent")
    );
    render(<Outbox />);
    await screen.findByText("Friday update");

    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
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
    render(<Outbox />);

    expect(
      await screen.findByText("Nothing waiting to send")
    ).toBeInTheDocument();
  });
});
