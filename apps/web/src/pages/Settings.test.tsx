import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const sessionValue = vi.hoisted(() => ({
  current: {
    user: { id: "u1", email: "me@x.com" },
    organizations: [
      { id: "o1", name: "Acme" },
      { id: "o2", name: "Beta" }
    ],
    currentOrganizationId: "o1",
    setCurrentOrganizationId: vi.fn(),
    addOrganization: vi.fn(),
    signOut: vi.fn()
  }
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => sessionValue.current
}));

vi.mock("../lib/api.js", () => ({
  outboundWebhookEvents: [
    "email.queued",
    "email.sent",
    "email.delivered",
    "email.opened",
    "email.clicked",
    "email.bounced",
    "email.complained",
    "email.failed"
  ],
  api: {
    createOrganization: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listWebhookEndpoints: vi.fn(),
    createWebhookEndpoint: vi.fn(),
    deleteWebhookEndpoint: vi.fn()
  }
}));

import { Settings } from "./Settings.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as {
  createOrganization: ReturnType<typeof vi.fn>;
  listApiKeys: ReturnType<typeof vi.fn>;
  createApiKey: ReturnType<typeof vi.fn>;
  revokeApiKey: ReturnType<typeof vi.fn>;
  listWebhookEndpoints: ReturnType<typeof vi.fn>;
  createWebhookEndpoint: ReturnType<typeof vi.fn>;
  deleteWebhookEndpoint: ReturnType<typeof vi.fn>;
};

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionValue.current.setCurrentOrganizationId = vi.fn();
    sessionValue.current.addOrganization = vi.fn();
    sessionValue.current.signOut = vi.fn();
    mockedApi.listApiKeys.mockResolvedValue([]);
    mockedApi.listWebhookEndpoints.mockResolvedValue([]);
  });

  it("renders account details", () => {
    render(<Settings />);
    expect(screen.getByText("me@x.com")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("disables the create button when the name is blank", () => {
    render(<Settings />);
    expect(
      screen.getByRole("button", { name: "Create organization" })
    ).toBeDisabled();
  });

  it("creates an organization", async () => {
    const user = userEvent.setup();
    mockedApi.createOrganization.mockResolvedValue({
      id: "o3",
      name: "Gamma",
      createdAt: ""
    });
    render(<Settings />);
    await user.type(screen.getByLabelText("New organization"), "Gamma");
    await user.click(
      screen.getByRole("button", { name: "Create organization" })
    );
    await waitFor(() =>
      expect(sessionValue.current.addOrganization).toHaveBeenCalledWith(
        { id: "o3", name: "Gamma", role: "OWNER" },
        true
      )
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("toasts on create failure", async () => {
    const user = userEvent.setup();
    mockedApi.createOrganization.mockRejectedValue(new Error("nope"));
    render(<Settings />);
    await user.type(screen.getByLabelText("New organization"), "Gamma");
    await user.click(
      screen.getByRole("button", { name: "Create organization" })
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
  });

  it("loads API keys for the active organization", async () => {
    mockedApi.listApiKeys.mockResolvedValue([
      {
        id: "key_1",
        organizationId: "o1",
        name: "Production",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null
      }
    ]);

    render(<Settings />);

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
        revokedAt: null
      },
      key: "qq_live_secret"
    });

    render(<Settings />);
    await user.type(screen.getByLabelText("Key name"), "Local app");
    await user.click(screen.getByRole("button", { name: /Create key/i }));

    expect(await screen.findByText("qq_live_secret")).toBeInTheDocument();
    expect(mockedApi.createApiKey).toHaveBeenCalledWith({
      organizationId: "o1",
      name: "Local app"
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
        revokedAt: null
      }
    ]);
    mockedApi.revokeApiKey.mockResolvedValue({
      id: "key_1",
      organizationId: "o1",
      name: "Production",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: "2026-01-02T00:00:00.000Z"
    });

    render(<Settings />);
    await screen.findByText("Production");
    await user.click(screen.getByLabelText("Revoke Production"));
    await user.click(screen.getByRole("button", { name: "Revoke key" }));

    await waitFor(() =>
      expect(mockedApi.revokeApiKey).toHaveBeenCalledWith("key_1")
    );
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
  });

  it("creates a webhook endpoint and shows the signing secret", async () => {
    const user = userEvent.setup();
    mockedApi.createWebhookEndpoint.mockResolvedValue({
      endpoint: {
        id: "wh_1",
        organizationId: "o1",
        name: "Production webhook",
        url: "https://example.com/webhooks/qqueue",
        events: ["email.sent"],
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      secret: "whsec_secret"
    });

    render(<Settings />);
    await user.type(
      screen.getByLabelText("Endpoint name"),
      "Production webhook"
    );
    await user.type(
      screen.getByLabelText("Endpoint URL"),
      "https://example.com/webhooks/qqueue"
    );
    await user.click(screen.getByRole("button", { name: "Create endpoint" }));

    expect(await screen.findByText("whsec_secret")).toBeInTheDocument();
    expect(mockedApi.createWebhookEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "o1",
        name: "Production webhook",
        url: "https://example.com/webhooks/qqueue"
      })
    );
  });

  it("deletes a webhook endpoint", async () => {
    const user = userEvent.setup();
    mockedApi.listWebhookEndpoints.mockResolvedValue([
      {
        id: "wh_1",
        organizationId: "o1",
        name: "Production webhook",
        url: "https://example.com/webhooks/qqueue",
        events: ["email.sent"],
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
    mockedApi.deleteWebhookEndpoint.mockResolvedValue(undefined);

    render(<Settings />);
    await screen.findByText("Production webhook");
    await user.click(screen.getByLabelText("Delete Production webhook"));
    await user.click(screen.getByRole("button", { name: "Delete endpoint" }));

    await waitFor(() =>
      expect(mockedApi.deleteWebhookEndpoint).toHaveBeenCalledWith("wh_1")
    );
  });

  it("signs out and redirects", async () => {
    const user = userEvent.setup();
    const original = window.location;
    const hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { set href(v: string) { hrefSetter(v); } }
    });
    render(<Settings />);
    await user.click(screen.getByRole("button", { name: /Sign out/i }));
    expect(sessionValue.current.signOut).toHaveBeenCalled();
    expect(hrefSetter).toHaveBeenCalledWith("/login");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: original
    });
  });
});
