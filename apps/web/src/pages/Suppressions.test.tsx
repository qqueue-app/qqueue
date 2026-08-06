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

vi.mock("../lib/api.js", () => ({
  api: {
    listSuppressions: vi.fn(),
    addSuppression: vi.fn(),
    deleteSuppression: vi.fn()
  }
}));

// Mutable so individual tests can view the page as a MEMBER; the default is
// an ADMIN, who sees every control.
const session = vi.hoisted(() => ({
  current: {
    currentOrganizationId: "org_1",
    currentOrganization: { id: "org_1", name: "Acme", role: "ADMIN" }
  }
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current
}));

import { api } from "../lib/api.js";
import { Suppressions } from "./Suppressions.js";

const mockedApi = api as unknown as {
  listSuppressions: ReturnType<typeof vi.fn>;
  addSuppression: ReturnType<typeof vi.fn>;
  deleteSuppression: ReturnType<typeof vi.fn>;
};

describe("Suppressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = {
      currentOrganizationId: "org_1",
      currentOrganization: { id: "org_1", name: "Acme", role: "ADMIN" }
    };
    mockedApi.listSuppressions.mockResolvedValue([
      {
        id: "s1",
        organizationId: "org_1",
        email: "blocked@example.com",
        reason: "BOUNCE",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
    mockedApi.addSuppression.mockResolvedValue({ id: "s2" });
    mockedApi.deleteSuppression.mockResolvedValue(undefined);
  });

  it("lists suppressed addresses with their reason", async () => { renderWithProviders(<Suppressions />);
    expect(await screen.findByText("blocked@example.com")).toBeInTheDocument();
    expect(screen.getByText("Bounced")).toBeInTheDocument();
  });

  it("manually suppresses a new address", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Suppressions />);
    await screen.findByText("blocked@example.com");

    await user.click(screen.getByRole("button", { name: /^block an address$/i }));
    await user.type(screen.getByLabelText("Email address"), "new@example.com");
    await user.click(screen.getByRole("button", { name: /^block$/i }));

    await waitFor(() =>
      expect(mockedApi.addSuppression).toHaveBeenCalledWith({
        organizationId: "org_1",
        email: "new@example.com",
        reason: "MANUAL"
      })
    );
    expect(toast.success).toHaveBeenCalledWith("Address blocked.");
  });

  it("shows the unblock control to OWNER/ADMIN", async () => { renderWithProviders(<Suppressions />);
    await screen.findByText("blocked@example.com");
    expect(screen.getByLabelText("Unblock this address")).toBeInTheDocument();
  });

  // Un-suppressing is OWNER/ADMIN on the API (Phase 3); members keep the
  // ability to block, but the unblock control (and its column) disappears.
  it("hides the unblock control from MEMBERs", async () => {
    session.current = {
      currentOrganizationId: "org_1",
      currentOrganization: { id: "org_1", name: "Acme", role: "MEMBER" }
    };
    renderWithProviders(<Suppressions />);
    await screen.findByText("blocked@example.com");
    expect(screen.queryByLabelText("Unblock this address")).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^block an address$/i })
    ).toBeInTheDocument();
  });
});
