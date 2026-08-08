import {
  openRowMenu,
  renderWithProviders,
  screen,
  waitFor,
} from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const sessionValue = vi.hoisted(() => ({
  current: { currentOrganizationId: "o1" },
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionValue.current,
}));

vi.mock("../../lib/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return {
    ApiError: actual.ApiError,
    apiBaseUrl: actual.apiBaseUrl,
    outboundWebhookEvents: actual.outboundWebhookEvents,
    api: {
      listApiKeys: vi.fn(),
      createApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
      listWebhookEndpoints: vi.fn(),
      createWebhookEndpoint: vi.fn(),
      deleteWebhookEndpoint: vi.fn(),
      listWebhookDeliveries: vi.fn(),
      retryWebhookDelivery: vi.fn(),
    },
  };
});

import { ApiSettings } from "./ApiSettings.js";
import { api } from "../../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const endpoint = {
  id: "wh_1",
  organizationId: "o1",
  name: "Production webhook",
  url: "https://example.com/webhooks/qqueue",
  events: ["email.sent"],
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.listApiKeys.mockResolvedValue([]);
  mockedApi.listWebhookEndpoints.mockResolvedValue([]);
  mockedApi.listWebhookDeliveries.mockResolvedValue([]);
});

describe("ApiSettings", () => {
  it("keeps keys and webhooks on one page for one audience", async () => {
    renderWithProviders(<ApiSettings />);
    expect(
      await screen.findByRole("heading", { name: "API keys" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Webhook endpoints" })
    ).toBeInTheDocument();
  });

  it("loads API keys for the active organization", async () => {
    mockedApi.listApiKeys.mockResolvedValue([
      {
        id: "key_1",
        organizationId: "o1",
        name: "Production",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);

    renderWithProviders(<ApiSettings />);

    expect(await screen.findByText("Production")).toBeInTheDocument();
    expect(mockedApi.listApiKeys).toHaveBeenCalledWith("o1");
  });

  it("creates an API key and shows the one-time secret", async () => {
    const user = userEvent.setup();
    mockedApi.createApiKey.mockResolvedValue({
      apiKey: {
        id: "key_1",
        organizationId: "o1",
        name: "Local app",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
      key: "qq_live_secret",
    });

    renderWithProviders(<ApiSettings />);
    await user.type(screen.getByLabelText("Key name"), "Local app");
    await user.click(screen.getByRole("button", { name: /Create key/i }));

    expect(await screen.findByText("qq_live_secret")).toBeInTheDocument();
    expect(mockedApi.createApiKey).toHaveBeenCalledWith({
      organizationId: "o1",
      name: "Local app",
    });
  });

  it("revokes an API key", async () => {
    const user = userEvent.setup();
    mockedApi.listApiKeys.mockResolvedValue([
      {
        id: "key_1",
        organizationId: "o1",
        name: "Production",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    mockedApi.revokeApiKey.mockResolvedValue({
      id: "key_1",
      organizationId: "o1",
      name: "Production",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: "2026-01-02T00:00:00.000Z",
    });

    renderWithProviders(<ApiSettings />);
    await screen.findByText("Production");
    await user.click(screen.getByRole("button", { name: "Revoke Production" }));
    await user.click(screen.getByRole("button", { name: "Revoke key" }));

    await waitFor(() =>
      expect(mockedApi.revokeApiKey).toHaveBeenCalledWith("key_1")
    );
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
  });

  it("renders the webhook events as settings rows, not a grid of boxes", async () => {
    renderWithProviders(<ApiSettings />);

    // Every event is a labelled row with a toggle and a plain-language
    // description; the wire name alone told nobody anything.
    const toggle = await screen.findByRole("switch", {
      name: "Enable email.complained",
    });
    expect(toggle).toBeInTheDocument();
    expect(
      screen.getByText("Marked as spam by the recipient.")
    ).toBeInTheDocument();
  });

  it("creates a webhook endpoint with the toggled events", async () => {
    const user = userEvent.setup();
    mockedApi.createWebhookEndpoint.mockResolvedValue({
      endpoint,
      secret: "whsec_secret",
    });

    renderWithProviders(<ApiSettings />);
    await user.type(
      screen.getByLabelText("Endpoint name"),
      "Production webhook"
    );
    await user.type(
      screen.getByLabelText("Endpoint URL"),
      "https://example.com/webhooks/qqueue"
    );
    // Off by default — turning it on has to reach the request.
    await user.click(screen.getByRole("switch", { name: "Enable email.opened" }));
    await user.click(screen.getByRole("button", { name: "Create endpoint" }));

    expect(await screen.findByText("whsec_secret")).toBeInTheDocument();
    expect(mockedApi.createWebhookEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "o1",
        name: "Production webhook",
        url: "https://example.com/webhooks/qqueue",
        events: expect.arrayContaining(["email.opened"]),
      })
    );
  });

  it("deletes a webhook endpoint from the row's overflow menu", async () => {
    const user = userEvent.setup();
    mockedApi.listWebhookEndpoints.mockResolvedValue([endpoint]);
    mockedApi.deleteWebhookEndpoint.mockResolvedValue(undefined);

    renderWithProviders(<ApiSettings />);
    await screen.findByText("Production webhook");
    await openRowMenu(user, "Production webhook");
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete Production webhook" })
    );
    await user.click(screen.getByRole("button", { name: "Delete endpoint" }));

    await waitFor(() =>
      expect(mockedApi.deleteWebhookEndpoint).toHaveBeenCalledWith("wh_1")
    );
  });

  it("shows webhook delivery details and retries a failed delivery", async () => {
    const user = userEvent.setup();
    mockedApi.listWebhookEndpoints.mockResolvedValue([endpoint]);
    mockedApi.listWebhookDeliveries.mockResolvedValue([
      {
        id: "del_1",
        organizationId: "o1",
        endpointId: "wh_1",
        emailEventId: "evt_1",
        eventName: "email.sent",
        status: "FAILED",
        attempts: 2,
        responseStatus: 500,
        error: "Webhook endpoint returned 500",
        nextAttemptAt: "2026-01-01T00:01:00.000Z",
        deliveredAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockedApi.retryWebhookDelivery.mockResolvedValue({
      id: "del_1",
      organizationId: "o1",
      endpointId: "wh_1",
      emailEventId: "evt_1",
      eventName: "email.sent",
      status: "PENDING",
      attempts: 2,
      responseStatus: null,
      error: null,
      nextAttemptAt: "2026-01-01T00:02:00.000Z",
      deliveredAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    renderWithProviders(<ApiSettings />);
    await screen.findByText("Production webhook");
    await user.click(
      screen.getByRole("button", {
        name: "View deliveries for Production webhook",
      })
    );

    expect(
      await screen.findByText("Webhook endpoint returned 500")
    ).toBeInTheDocument();
    expect(mockedApi.listWebhookDeliveries).toHaveBeenCalledWith("wh_1");

    await user.click(
      screen.getByRole("button", { name: "Retry email.sent delivery" })
    );
    await waitFor(() =>
      expect(mockedApi.retryWebhookDelivery).toHaveBeenCalledWith("del_1")
    );
    expect(await screen.findByText("PENDING")).toBeInTheDocument();
  });
});
