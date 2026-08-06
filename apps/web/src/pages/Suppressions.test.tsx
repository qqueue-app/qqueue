import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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

  it("lists suppressed addresses with their reason", async () => {
    render(<Suppressions />);
    expect(await screen.findByText("blocked@example.com")).toBeInTheDocument();
    expect(screen.getByText("BOUNCE")).toBeInTheDocument();
  });

  it("manually suppresses a new address", async () => {
    const user = userEvent.setup();
    render(<Suppressions />);
    await screen.findByText("blocked@example.com");

    await user.click(screen.getByRole("button", { name: /^block address$/i }));
    await user.type(screen.getByLabelText("Email"), "new@example.com");
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

  it("shows the unblock control to OWNER/ADMIN", async () => {
    render(<Suppressions />);
    await screen.findByText("blocked@example.com");
    expect(screen.getByLabelText("Unblock address")).toBeInTheDocument();
  });

  // Un-suppressing is OWNER/ADMIN on the API (Phase 3); members keep the
  // ability to block, but the unblock control (and its column) disappears.
  it("hides the unblock control from MEMBERs", async () => {
    session.current = {
      currentOrganizationId: "org_1",
      currentOrganization: { id: "org_1", name: "Acme", role: "MEMBER" }
    };
    render(<Suppressions />);
    await screen.findByText("blocked@example.com");
    expect(screen.queryByLabelText("Unblock address")).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^block address$/i })
    ).toBeInTheDocument();
  });
});
