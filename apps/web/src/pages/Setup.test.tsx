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
import { ApiError, api } from "../lib/api.js";
import { invalidateSetupStatus } from "../lib/setup-status.js";
import { SessionProvider } from "../lib/session-context.js";
import { saveSession } from "../lib/session.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const DRAFT_KEY = "qqueue.setup-draft";

function seedDraft(draft: unknown) {
  window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function readDraftRaw() {
  return window.sessionStorage.getItem(DRAFT_KEY);
}

function readDraft() {
  return JSON.parse(readDraftRaw() ?? "{}") as Record<string, unknown>;
}

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
    window.sessionStorage.clear();
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
    expect(readDraftRaw()).toBeNull();
  });

  it("restores the account step and typed fields from a draft", async () => {
    seedDraft({
      step: "account",
      account: { email: "ben@acme.com", name: "Ben", organizationName: "Acme" }
    });
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: true,
      setupCompleted: false,
      allowPublicRegistration: true
    });

    renderSetup();

    expect(
      await screen.findByText("Create the administrator account")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Set up your QQueue server")
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("ben@acme.com");
    expect(screen.getByLabelText("Name (optional)")).toHaveValue("Ben");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(
      screen.getByText(
        "We restored your draft — re-enter the password to continue."
      )
    ).toBeInTheDocument();
  });

  it("ignores a stale drafted step when the server needs full setup", async () => {
    seedDraft({ step: "policy", allowPublicRegistration: true });
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: true,
      setupCompleted: false,
      allowPublicRegistration: true
    });

    renderSetup();

    expect(
      await screen.findByText("Set up your QQueue server")
    ).toBeInTheDocument();
  });

  it("restores a drafted step under StrictMode's double-mounted effects", async () => {
    seedDraft({
      step: "account",
      account: { email: "ben@acme.com", name: "", organizationName: "" }
    });
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
      await screen.findByText("Create the administrator account")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("ben@acme.com");
  });

  it("persists typed account fields but never the password", async () => {
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: true,
      setupCompleted: false,
      allowPublicRegistration: true
    });

    renderSetup();

    await screen.findByText("Set up your QQueue server");
    await userEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await userEvent.type(screen.getByLabelText("Email"), "ben@acme.com");
    await userEvent.type(screen.getByLabelText("Password"), "supersecret99");

    const raw = readDraftRaw() ?? "";
    expect(raw).toContain("ben@acme.com");
    expect(raw).not.toContain("supersecret99");
    expect(readDraft().step).toBe("account");
  });

  it("clears the account draft section once the account is committed", async () => {
    seedDraft({
      step: "account",
      account: { email: "ben@acme.com", name: "Ben", organizationName: "Acme" }
    });
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: true,
      setupCompleted: false,
      allowPublicRegistration: true
    });
    mockedApi.register.mockResolvedValue({
      user: { id: "user_1", email: "ben@acme.com", name: "Ben" },
      organization: { id: "org_1", name: "Acme" },
      tokens: { accessToken: "token", refreshToken: "refresh" }
    });

    renderSetup();

    await screen.findByText("Create the administrator account");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account and continue" })
    );

    expect(
      await screen.findByText("Connect a sending account")
    ).toBeInTheDocument();
    expect(readDraft().account).toBeUndefined();
    expect(readDraft().step).toBe("smtp");
  });

  it("restores SMTP draft fields on resume, never persisting the password", async () => {
    signInAsAdmin();
    seedDraft({
      step: "smtp",
      smtp: {
        name: "Default sending account",
        host: "smtp.acme.com",
        port: "465",
        secure: true,
        username: "mailer@acme.com",
        fromEmail: "hello@acme.com",
        fromName: "Acme"
      }
    });
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: false,
      allowPublicRegistration: false
    });
    mockedApi.listSMTPConnections.mockResolvedValue([]);

    renderSetup();

    await screen.findByText("Welcome back — let's finish setting up");
    expect(screen.getByLabelText("Host")).toHaveValue("smtp.acme.com");
    expect(screen.getByLabelText("Username")).toHaveValue("mailer@acme.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(
      screen.getByText(
        "We restored your draft — re-enter the password to continue."
      )
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Password"), "smtppass123");
    await userEvent.type(screen.getByLabelText("Host"), "x");

    const raw = readDraftRaw() ?? "";
    expect(raw).not.toContain("smtppass123");
    expect(
      (readDraft().smtp as Record<string, unknown>).host
    ).toBe("smtp.acme.comx");
  });

  it("resumes at the test-email step with the drafted registration policy", async () => {
    signInAsAdmin();
    seedDraft({ step: "test-email", allowPublicRegistration: true });
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

    await screen.findByText("Send yourself a test email");
    await userEvent.click(
      screen.getByRole("button", { name: "Skip and finish setup" })
    );

    await vi.waitFor(() =>
      expect(mockedApi.completeSetup).toHaveBeenCalledWith({
        allowPublicRegistration: true
      })
    );
  });

  it("falls back to the smtp step when the drafted step lacks a connection", async () => {
    signInAsAdmin();
    seedDraft({ step: "test-email" });
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

  it("clears the draft when completion reports an already-finished setup", async () => {
    signInAsAdmin();
    seedDraft({ step: "test-email", allowPublicRegistration: false });
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: false,
      allowPublicRegistration: false
    });
    mockedApi.listSMTPConnections.mockResolvedValue([
      { id: "smtp_1", name: "Default", isDefault: true }
    ]);
    mockedApi.completeSetup.mockRejectedValue(
      new ApiError("Setup already completed", 409)
    );

    renderSetup();

    await screen.findByText("Send yourself a test email");
    await userEvent.click(
      screen.getByRole("button", { name: "Skip and finish setup" })
    );

    expect(
      await screen.findByText("Your server is ready")
    ).toBeInTheDocument();
    expect(readDraftRaw()).toBeNull();
  });

  it("clears the draft when setup is already complete on load", async () => {
    seedDraft({ step: "account", account: { email: "ben@acme.com" } });
    mockedApi.setupStatus.mockResolvedValue({
      needsSetup: false,
      setupCompleted: true,
      allowPublicRegistration: false
    });

    renderSetup();

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/", { replace: true })
    );
    expect(readDraftRaw()).toBeNull();
  });
});
