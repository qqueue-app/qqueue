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
  api: { createOrganization: vi.fn() }
}));

import { Settings } from "./Settings.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as {
  createOrganization: ReturnType<typeof vi.fn>;
};

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionValue.current.setCurrentOrganizationId = vi.fn();
    sessionValue.current.addOrganization = vi.fn();
    sessionValue.current.signOut = vi.fn();
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
