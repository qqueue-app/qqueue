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

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" })
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
});
