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

// Only the network surface is stubbed. `deriveReputationAlerts` stays real, so
// the alert assertions below exercise the actual thresholds and volume gate
// rather than a fixture asserting itself.
vi.mock("../lib/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api.js")>()),
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

import { api, type DeliverabilityOverview } from "../lib/api.js";
import { Deliverability } from "./Deliverability.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

/**
 * 1,000 attempts, 80 of which bounced — past the 5% line and past the minimum
 * volume, so alerts fire. Overridable per test.
 */
function overview(
  overrides: {
    totals?: Partial<DeliverabilityOverview["totals"]>;
    rates?: Partial<DeliverabilityOverview["rates"]>;
    deliverySignal?: DeliverabilityOverview["deliverySignal"];
  } = {}
): DeliverabilityOverview {
  return {
    window: { from: "2026-05-17T00:00:00.000Z", to: "2026-06-16T00:00:00.000Z" },
    deliverySignal: overrides.deliverySignal ?? "confirmed",
    totals: {
      attempted: 1000,
      sent: 920,
      failed: 80,
      suppressedAtSend: 15,
      cancelled: 2,
      inFlight: 3,
      confirmedDelivered: 890,
      bounced: 80,
      hardBounced: 60,
      softBounced: 15,
      blockBounced: 5,
      complained: 4,
      opened: 300,
      clicked: 100,
      suppressedInWindow: 9,
      suppressedTotal: 137,
      ...overrides.totals
    },
    rates: {
      accepted: 0.92,
      confirmedDelivery: 0.967,
      bounce: 0.08,
      complaint: 0.004,
      open: 0.326,
      click: 0.108,
      ...overrides.rates
    }
  };
}

describe("Deliverability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.deliverabilityOverview.mockResolvedValue(overview());
    mockedApi.deliverabilityDomains.mockResolvedValue({
      domains: [
        {
          domain: "gmail.com",
          attempted: 60,
          sent: 56,
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

  it("shows the overview, alerts, and per-domain table", async () => { renderWithProviders(<Deliverability />);
    expect(await screen.findByText("Reputation alerts")).toBeInTheDocument();
    expect(screen.getByText(/Bounce rate is above 5%/)).toBeInTheDocument();
    expect(screen.getByText("gmail.com")).toBeInTheDocument();
    // Bounce rate stat rendered as a percentage.
    expect(screen.getAllByText("8.0%").length).toBeGreaterThan(0);
  });

  it("names the acceptance rate as acceptance, not delivery", async () => { renderWithProviders(<Deliverability />);
    await screen.findByText("Accepted by server");
    // "Delivery rate" was the open rate relabelled; the tile is gone for good.
    expect(screen.queryByText("Delivery rate")).not.toBeInTheDocument();
    expect(screen.getByText("92.0%")).toBeInTheDocument();
  });

  it("says so instead of guessing when no delivery signal exists", async () => {
    mockedApi.deliverabilityOverview.mockResolvedValue(
      overview({
        deliverySignal: "none",
        rates: { confirmedDelivery: null }
      })
    );
    renderWithProviders(<Deliverability />);

    expect(
      await screen.findByText("No delivery confirmation yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("No delivery confirmation source configured.")
    ).toBeInTheDocument();
    // An em dash, never 0.0% — that would claim a measurement nobody took.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders a rate with no denominator as a dash", async () => {
    mockedApi.deliverabilityOverview.mockResolvedValue(
      overview({
        totals: { attempted: 0, sent: 0, failed: 0, bounced: 0 },
        rates: {
          accepted: null,
          bounce: null,
          complaint: null,
          open: null,
          click: null,
          confirmedDelivery: null
        }
      })
    );
    renderWithProviders(<Deliverability />);

    await screen.findByText("Accepted by server");
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("stays quiet on a handful of sends", async () => {
    // 2 of 5 bounced is 40% and means nothing; alerting on it trains people to
    // ignore the banner.
    mockedApi.deliverabilityOverview.mockResolvedValue(
      overview({
        totals: { attempted: 5, sent: 3, failed: 2, bounced: 2 },
        rates: { bounce: 0.4, complaint: 0.2 }
      })
    );
    renderWithProviders(<Deliverability />);

    await screen.findByText("Accepted by server");
    expect(screen.queryByText("Reputation alerts")).not.toBeInTheDocument();
  });

  it("derives alerts locally instead of paying for a second aggregation", async () => { renderWithProviders(<Deliverability />);
    await screen.findByText("Reputation alerts");
    expect(mockedApi.deliverabilityAlerts).not.toHaveBeenCalled();
  });

  it("saves the auto-suppression policy", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Deliverability />);
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
    renderWithProviders(<Deliverability />);
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
