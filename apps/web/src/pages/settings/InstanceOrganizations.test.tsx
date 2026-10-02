import {
  openRowMenu,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

vi.mock("../../lib/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/api.js")>(
      "../../lib/api.js"
    );
  return {
    ApiError: actual.ApiError,
    api: {
      getMe: vi.fn(),
      listInstanceOrganizations: vi.fn(),
      listInstanceMutes: vi.fn(),
      getInstanceOrganization: vi.fn(),
      addInstanceMute: vi.fn(),
      removeInstanceMute: vi.fn(),
    },
  };
});

import { api } from "../../lib/api.js";
import { InstanceOrganizations } from "./InstanceOrganizations.js";

const organizations = [
  {
    id: "org_1",
    name: "Acme",
    memberCount: 2,
    domainCount: 1,
    sendingAccountCount: 1,
    createdAt: "2026-01-01",
    muted: false,
  },
  {
    id: "org_2",
    name: "Beta",
    memberCount: 1,
    domainCount: 0,
    sendingAccountCount: 0,
    createdAt: "2026-01-02",
    muted: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMe).mockResolvedValue({
    user: { id: "admin_1", email: "admin@acme.test", isInstanceAdmin: true },
    organizations: [],
  });
  vi.mocked(api.listInstanceOrganizations).mockResolvedValue(organizations);
  vi.mocked(api.listInstanceMutes).mockResolvedValue([
    { id: "mute_1", scope: "ORG", target: "org_2", createdAt: "2026-01-02" },
  ]);
  vi.mocked(api.getInstanceOrganization).mockResolvedValue({
    ...organizations[0],
    members: [
      {
        id: "user_1",
        name: "Ada",
        email: "ada@acme.test",
        role: "OWNER",
        joinedAt: "2026-01-01",
      },
    ],
    domains: ["acme.test"],
    sendingAccounts: [
      {
        id: "smtp_1",
        name: "Primary",
        fromEmail: "hello@acme.test",
        isDefault: true,
      },
    ],
    stats: { sent: 1200, failed: 2, bounced: 1, suppressed: 3 },
  });
  vi.mocked(api.addInstanceMute).mockResolvedValue({
    id: "mute_2",
    scope: "ORG",
    target: "org_1",
    createdAt: "2026-01-03",
  });
});

describe("InstanceOrganizations", () => {
  it("hides muted organizations until the administrator reveals them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceOrganizations />);

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show 1 muted" }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide 1 muted" }));
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("shows infrastructure detail without exposing organization messages", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceOrganizations />);

    await screen.findByText("Acme");
    await user.click(screen.getByRole("button", { name: "View details" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Ada")).toBeInTheDocument();
    expect(within(dialog).getByText("acme.test")).toBeInTheDocument();
    expect(within(dialog).getByText("hello@acme.test")).toBeInTheDocument();
    expect(within(dialog).getByText("1,200")).toBeInTheDocument();
    expect(api.getInstanceOrganization).toHaveBeenCalledWith("org_1");
    expect(
      within(dialog).queryByRole("link", { name: /inbox|messages/i })
    ).not.toBeInTheDocument();
  });

  it("keeps hide-in-my-lists as a personal mute action", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceOrganizations />);

    await screen.findByText("Acme");
    await openRowMenu(user, "Acme");
    await user.click(
      screen.getByRole("menuitem", { name: "Hide from my lists" })
    );

    await waitFor(() =>
      expect(api.addInstanceMute).toHaveBeenCalledWith({
        scope: "ORG",
        target: "org_1",
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Acme hidden from your lists. Their access is unchanged."
    );
  });
});
