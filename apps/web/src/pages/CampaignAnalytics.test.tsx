import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: { campaignAnalytics: vi.fn() }
}));

import { CampaignAnalytics } from "./CampaignAnalytics.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as {
  campaignAnalytics: ReturnType<typeof vi.fn>;
};

const analytics = {
  campaign: { id: "cmp1", name: "Spring", status: "SENT" },
  totals: {
    recipients: 100,
    sent: 90,
    failed: 2,
    delivered: 88,
    opened: 50,
    uniqueOpened: 40,
    clicked: 20,
    uniqueClicked: 15,
    bounced: 3,
    complained: 1
  },
  rates: { open: 0.4, click: 0.15, bounce: 0.03 },
  links: [{ url: "https://example.com", clicks: 12 }],
  recentEvents: [
    {
      id: "e1",
      type: "OPENED",
      occurredAt: "2026-01-01T10:00:00Z",
      toEmail: "to@x.com"
    }
  ]
};

function renderAnalytics() {
  return render(
    <MemoryRouter initialEntries={["/campaigns/cmp1/analytics"]}>
      <Routes>
        <Route
          path="/campaigns/:id/analytics"
          element={<CampaignAnalytics />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("CampaignAnalytics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and renders totals, rates, links and events", async () => {
    mockedApi.campaignAnalytics.mockResolvedValue(analytics);
    renderAnalytics();
    expect(await screen.findByText("Spring · Analytics")).toBeInTheDocument();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    expect(screen.getByText("OPENED")).toBeInTheDocument();
    expect(screen.getByText("to@x.com")).toBeInTheDocument();
    // open rate appears in a card detail
    expect(screen.getByText(/40.0% open rate/)).toBeInTheDocument();
  });

  it("shows empty states for no links and no events", async () => {
    mockedApi.campaignAnalytics.mockResolvedValue({
      ...analytics,
      links: [],
      recentEvents: []
    });
    renderAnalytics();
    expect(await screen.findByText("No clicks yet")).toBeInTheDocument();
    expect(screen.getByText("No events yet")).toBeInTheDocument();
  });

  it("toasts on load failure", async () => {
    mockedApi.campaignAnalytics.mockRejectedValue(new Error("nope"));
    renderAnalytics();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
  });
});
