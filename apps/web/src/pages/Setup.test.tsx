import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigate };
});

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/api.js")>(
    "../lib/api.js"
  );
  return {
    ApiError: actual.ApiError,
    api: {
      setupStatus: vi.fn(),
      completeSetup: vi.fn(),
      register: vi.fn(),
      createSMTPConnection: vi.fn(),
      listSMTPConnections: vi.fn(),
      sendManualEmail: vi.fn()
    }
  };
});

import { Setup } from "./Setup.js";
import { api } from "../lib/api.js";
import { invalidateSetupStatus } from "../lib/setup-status.js";
import { SessionProvider } from "../lib/session-context.js";
import { saveSession } from "../lib/session.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={["/setup"]}>
      <SessionProvider>
        <Setup />
      </SessionProvider>
    </MemoryRouter>
  );
}

function signInAsAdmin() {
  saveSession({
    user: { id: "user_1", email: "admin@acme.com", name: "Admin" },
    accessToken: "token",
    refreshToken: "refresh",
    currentOrganizationId: "org_1",
    organizations: [{ id: "org_1", name: "Acme", role: "OWNER" }]
  });
}

describe("Setup", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    invalidateSetupStatus();
  });

  it("starts at the welcome step on a fresh install", async () => {
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: true,
      setupCompleted: false,
      allowPublicRegistration: true
    });

    renderSetup();

    expect(
      await screen.findByText("Set up your QQueue server")
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Start setup" })
    );
    expect(
      screen.getByText("Create the administrator account")
    ).toBeInTheDocument();
  });

  it("resolves the first-run status under StrictMode's double-mounted effects", async () => {
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: true,
      setupCompleted: false,
      allowPublicRegistration: true
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/setup"]}>
          <SessionProvider>
            <Setup />
          </SessionProvider>
        </MemoryRouter>
      </StrictMode>
    );

    expect(
      await screen.findByText("Set up your QQueue server")
    ).toBeInTheDocument();
  });

  it("redirects home when setup is already complete", async () => {
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: true,
      allowPublicRegistration: false
    });

    renderSetup();

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/", { replace: true })
    );
  });

  it("sends unauthenticated visitors to login when an admin exists", async () => {
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: false,
      allowPublicRegistration: false
    });

    renderSetup();

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/login", { replace: true })
    );
  });

  it("resumes at the sending-account step for the signed-in admin", async () => {
    signInAsAdmin();
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: false,
      allowPublicRegistration: false
    });
    mockedApi.listSMTPConnections.mockResolvedValue([]);

    renderSetup();

    expect(
      await screen.findByText("Welcome back — let's finish setting up")
    ).toBeInTheDocument();
  });

  it("skips ahead to the policy step when a sending account already exists", async () => {
    signInAsAdmin();
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: false,
      allowPublicRegistration: false
    });
    mockedApi.listSMTPConnections.mockResolvedValue([
      { id: "smtp_1", name: "Default", isDefault: true }
    ]);

    renderSetup();

    expect(
      await screen.findByText("Who can register on this server?")
    ).toBeInTheDocument();
  });

  it("completes setup with the chosen registration policy", async () => {
    signInAsAdmin();
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: false,
      allowPublicRegistration: false
    });
    mockedApi.listSMTPConnections.mockResolvedValue([
      { id: "smtp_1", name: "Default", isDefault: true }
    ]);
    mockedApi.completeSetup.mockResolvedValue({
      setupCompletedAt: "2026-01-01T00:00:00.000Z"
    });

    renderSetup();

    await screen.findByText("Who can register on this server?");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Skip and finish setup" })
    );

    await vi.waitFor(() =>
      expect(mockedApi.completeSetup).toHaveBeenCalledWith({
        allowPublicRegistration: false
      })
    );
    expect(
      await screen.findByText("Your server is ready")
    ).toBeInTheDocument();
    expect(mockedApi.sendManualEmail).not.toHaveBeenCalled();
  });
});
