import { renderWithProviders, screen, waitFor } from "../../test/render.js";
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
  current: {
    organizations: [
      { id: "o1", name: "Acme", role: "OWNER" },
      { id: "o2", name: "Beta", role: "OWNER" },
    ],
    currentOrganizationId: "o1",
    setCurrentOrganizationId: vi.fn(),
    addOrganization: vi.fn(),
  },
}));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionValue.current,
}));

vi.mock("../../lib/api.js", () => ({
  api: {
    createOrganization: vi.fn(),
    updateOrganization: vi.fn(),
  },
}));

import { OrganizationSettings } from "./OrganizationSettings.js";
import { api } from "../../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  sessionValue.current.setCurrentOrganizationId = vi.fn();
  sessionValue.current.addOrganization = vi.fn();
});

describe("OrganizationSettings", () => {
  it("links back to the hub", () => {
    renderWithProviders(<OrganizationSettings />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings"
    );
  });

  it("disables the create button when the name is blank", () => {
    renderWithProviders(<OrganizationSettings />);
    expect(
      screen.getByRole("button", { name: "Create organization" })
    ).toBeDisabled();
  });

  it("creates an organization and makes it active", async () => {
    const user = userEvent.setup();
    mockedApi.createOrganization.mockResolvedValue({
      id: "o3",
      name: "Gamma",
      createdAt: "",
    });

    renderWithProviders(<OrganizationSettings />);
    await user.type(screen.getByLabelText("Name"), "Gamma");
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

    renderWithProviders(<OrganizationSettings />);
    await user.type(screen.getByLabelText("Name"), "Gamma");
    await user.click(
      screen.getByRole("button", { name: "Create organization" })
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
  });

  it("renames the active organization without changing its role", async () => {
    const user = userEvent.setup();
    mockedApi.updateOrganization.mockResolvedValue({
      id: "o1",
      name: "Acme Corp",
      createdAt: "",
    });

    renderWithProviders(<OrganizationSettings />);
    await user.type(screen.getByLabelText("Organization name"), "Acme Corp");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(mockedApi.updateOrganization).toHaveBeenCalledWith("o1", {
        name: "Acme Corp",
      })
    );
    expect(sessionValue.current.addOrganization).toHaveBeenCalledWith(
      { id: "o1", name: "Acme Corp", role: "OWNER" },
      false
    );
  });

  it("switches the active organization", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationSettings />);

    await user.click(screen.getByLabelText("Organization"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    await waitFor(() =>
      expect(sessionValue.current.setCurrentOrganizationId).toHaveBeenCalledWith(
        "o2"
      )
    );
  });
});
