import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigate };
});

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: { login: vi.fn(), register: vi.fn() }
}));

import { Login } from "./Login.js";
import { api } from "../lib/api.js";
import { SessionProvider } from "../lib/session-context.js";

const mockedApi = api as unknown as {
  login: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
};

function renderLogin(mode: "login" | "register" = "login") {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <Login mode={mode} />
      </SessionProvider>
    </MemoryRouter>
  );
}

describe("Login", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => vi.clearAllMocks());

  it("renders the sign-in form", () => {
    renderLogin("login");
    expect(
      screen.getByRole("button", { name: "Sign in" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Name (optional)")).not.toBeInTheDocument();
  });

  it("renders extra fields in register mode", () => {
    renderLogin("register");
    expect(screen.getByText("Create your account")).toBeInTheDocument();
    expect(screen.getByLabelText("Name (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Organization (optional)")).toBeInTheDocument();
  });

  it("validates an invalid email", async () => {
    const user = userEvent.setup();
    renderLogin("login");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Enter a valid email address.")
    ).toBeInTheDocument();
    expect(mockedApi.login).not.toHaveBeenCalled();
  });

  it("requires a password", async () => {
    const user = userEvent.setup();
    renderLogin("login");
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Password is required.")
    ).toBeInTheDocument();
  });

  it("enforces an 8-character password in register mode", async () => {
    const user = userEvent.setup();
    renderLogin("register");
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByText("Password must be at least 8 characters.")
    ).toBeInTheDocument();
  });

  it("logs in and navigates home on success", async () => {
    const user = userEvent.setup();
    mockedApi.login.mockResolvedValue({
      user: { id: "u1", email: "a@b.com" },
      organizations: [{ id: "o1", name: "Acme", role: "OWNER" }],
      tokens: { accessToken: "t", refreshToken: "r" }
    });
    renderLogin("login");
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(toast.success).toHaveBeenCalledWith("Signed in.");
  });

  it("registers and navigates home on success", async () => {
    const user = userEvent.setup();
    mockedApi.register.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", name: "Ada" },
      organization: { id: "o1", name: "Acme", createdAt: "" },
      tokens: { accessToken: "t", refreshToken: "r" }
    });
    renderLogin("register");
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.type(screen.getByLabelText("Name (optional)"), "Ada");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(toast.success).toHaveBeenCalled();
  });

  it("shows an error toast when login fails", async () => {
    const user = userEvent.setup();
    mockedApi.login.mockRejectedValue(new Error("Bad creds"));
    renderLogin("login");
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Bad creds"));
  });

  it("switches between login and register modes", async () => {
    const user = userEvent.setup();
    renderLogin("login");
    await user.click(
      screen.getByRole("button", { name: "Create an account" })
    );
    expect(navigate).toHaveBeenCalledWith("/register");
  });
});
