import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: {
    deliverabilityOverview: vi.fn(),
    deliverabilityAlerts: vi.fn(),
    deliverabilityDomains: vi.fn(),
    getSuppressionPolicy: vi.fn(),
    listDomainThrottles: vi.fn(),
    updateSuppressionPolicy: vi.fn(),
    upsertDomainThrottle: vi.fn(),
    deleteDomainThrottle: vi.fn()
  }
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" })
}));

import { api } from "../lib/api.js";
import { Deliverability } from "./Deliverability.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("Deliverability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.deliverabilityOverview.mockResolvedValue({
      window: { from: "2026-05-17T00:00:00.000Z", to: "2026-06-16T00:00:00.000Z" },
      totals: {
        sent: 100,
        delivered: 90,
        opened: 30,
        clicked: 10,
        bounced: 8,
        hardBounced: 6,
        softBounced: 2,
        complained: 1,
        suppressed: 12
      },
      rates: { delivery: 0.9, bounce: 0.08, complaint: 0.01, open: 0.3, click: 0.1 }
    });
    mockedApi.deliverabilityAlerts.mockResolvedValue({
      alerts: [
        {
          level: "critical",
          metric: "bounceRate",
          value: 0.08,
          threshold: 0.05,
          message: "Bounce rate is above 5%."
        }
      ]
    });
    mockedApi.deliverabilityDomains.mockResolvedValue({
      truncated: false,
      domains: [
        {
          domain: "gmail.com",
          sent: 60,
          delivered: 55,
          bounced: 4,
          complained: 1,
          bounceRate: 0.066,
          complaintRate: 0.016
        }
      ]
    });
    mockedApi.getSuppressionPolicy.mockResolvedValue({
      organizationId: "org_1",
      softBounceThreshold: 3,
      softBounceWindowDays: 30
    });
    mockedApi.listDomainThrottles.mockResolvedValue({
      throttles: [
        { id: "t1", organizationId: "org_1", domain: "gmail.com", maxPerMinute: 30 }
      ],
      defaultPerMinute: 60
    });
    mockedApi.updateSuppressionPolicy.mockResolvedValue({});
    mockedApi.upsertDomainThrottle.mockResolvedValue({});
    mockedApi.deleteDomainThrottle.mockResolvedValue(undefined);
  });

  it("shows the overview, alerts, and per-domain table", async () => {
    render(<Deliverability />);
    expect(await screen.findByText("Reputation alerts")).toBeInTheDocument();
    expect(screen.getByText("Bounce rate is above 5%.")).toBeInTheDocument();
    expect(screen.getByText("gmail.com")).toBeInTheDocument();
    // Bounce rate stat rendered as a percentage.
    expect(screen.getAllByText("8.0%").length).toBeGreaterThan(0);
  });

  it("saves the auto-suppression policy", async () => {
    const user = userEvent.setup();
    render(<Deliverability />);
    await screen.findByText("Reputation alerts");

    const threshold = screen.getByLabelText("Soft-bounce threshold");
    await user.clear(threshold);
    await user.type(threshold, "5");
    await user.click(screen.getByRole("button", { name: /save policy/i }));

    await waitFor(() =>
      expect(mockedApi.updateSuppressionPolicy).toHaveBeenCalledWith({
        organizationId: "org_1",
        softBounceThreshold: 5,
        softBounceWindowDays: 30
      })
    );
  });

  it("adds a per-domain throttle", async () => {
    const user = userEvent.setup();
    render(<Deliverability />);
    await screen.findByText("Reputation alerts");

    await user.type(screen.getByLabelText("Domain"), "yahoo.com");
    const rate = screen.getByLabelText("Per minute");
    await user.clear(rate);
    await user.type(rate, "20");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() =>
      expect(mockedApi.upsertDomainThrottle).toHaveBeenCalledWith({
        organizationId: "org_1",
        domain: "yahoo.com",
        maxPerMinute: 20
      })
    );
  });
});
