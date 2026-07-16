import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const setSession = vi.hoisted(() => vi.fn());
vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ setSession }),
}));

vi.mock("../lib/api.js", () => ({
  api: { lookupInvite: vi.fn(), acceptInvite: vi.fn() },
}));

import { AcceptInvite } from "./AcceptInvite.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as {
  lookupInvite: ReturnType<typeof vi.fn>;
  acceptInvite: ReturnType<typeof vi.fn>;
};

function renderAt(token?: string) {
  const path = token ? `/accept-invite?token=${token}` : "/accept-invite";
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AcceptInvite />
    </MemoryRouter>
  );
}

const newAccountInvite = {
  email: "new@x.com",
  role: "MEMBER",
  organizationName: "Acme",
  expiresAt: "2999-01-01T00:00:00.000Z",
  hasAccount: false,
};

beforeEach(() => vi.clearAllMocks());

describe("AcceptInvite", () => {
  it("creates a new account and signs in", async () => {
    mockedApi.lookupInvite.mockResolvedValue(newAccountInvite);
    mockedApi.acceptInvite.mockResolvedValue({
      organization: { id: "org_1", name: "Acme" },
      requiresSignIn: false,
      role: "MEMBER",
      user: {
        id: "u1",
        email: "new@x.com",
        name: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      tokens: { accessToken: "a", refreshToken: "r" },
    });

    renderAt("a-token");
    const pwd = await screen.findByLabelText("Choose a password");
    await userEvent.type(pwd, "password123");
    await userEvent.click(
      screen.getByRole("button", { name: /Create account/ })
    );

    await waitFor(() => expect(mockedApi.acceptInvite).toHaveBeenCalled());
    expect(setSession).toHaveBeenCalledWith(
      expect.objectContaining({ currentOrganizationId: "org_1" })
    );
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("validates the password for a new account", async () => {
    mockedApi.lookupInvite.mockResolvedValue(newAccountInvite);
    renderAt("a-token");
    await screen.findByLabelText("Choose a password");
    await userEvent.click(
      screen.getByRole("button", { name: /Create account/ })
    );
    expect(
      await screen.findByText("Password must be at least 8 characters.")
    ).toBeInTheDocument();
    expect(mockedApi.acceptInvite).not.toHaveBeenCalled();
  });

  it("toasts when accepting fails", async () => {
    mockedApi.lookupInvite.mockResolvedValue(newAccountInvite);
    mockedApi.acceptInvite.mockRejectedValue(new Error("nope"));
    renderAt("a-token");
    const pwd = await screen.findByLabelText("Choose a password");
    await userEvent.type(pwd, "password123");
    await userEvent.click(
      screen.getByRole("button", { name: /Create account/ })
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
    expect(setSession).not.toHaveBeenCalled();
  });

  it("grants membership to an existing account and asks them to sign in", async () => {
    mockedApi.lookupInvite.mockResolvedValue({
      ...newAccountInvite,
      email: "old@x.com",
      role: "ADMIN",
      hasAccount: true,
    });
    mockedApi.acceptInvite.mockResolvedValue({
      organization: { id: "org_1", name: "Acme" },
      requiresSignIn: true,
      alreadyMember: false,
    });

    renderAt("a-token");
    const accept = await screen.findByRole("button", {
      name: "Accept invitation",
    });
    await userEvent.click(accept);

    expect(await screen.findByText("You're in")).toBeInTheDocument();
    expect(setSession).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("shows an error state for an invalid invitation and returns to sign in", async () => {
    mockedApi.lookupInvite.mockRejectedValue(
      new Error("This invitation is invalid or has expired")
    );
    renderAt("a-token");
    expect(
      await screen.findByText("Invitation unavailable")
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("shows an error when the link has no token", async () => {
    renderAt();
    expect(
      await screen.findByText("Invitation unavailable")
    ).toBeInTheDocument();
    expect(mockedApi.lookupInvite).not.toHaveBeenCalled();
  });
});
