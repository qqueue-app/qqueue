import { openRowMenu, renderWithProviders, screen, waitFor, within } from "../../test/render.js";
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
    await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return {
    ApiError: actual.ApiError,
    api: {
      getMe: vi.fn(),
      listInstanceMailDomains: vi.fn(),
      listInstanceOrganizations: vi.fn(),
      listInstanceMutes: vi.fn(),
      getInstanceMailDomainDns: vi.fn(),
      createInstanceMailDomain: vi.fn(),
      updateInstanceMailDomain: vi.fn(),
      assignInstanceMailDomain: vi.fn(),
      deleteInstanceMailDomain: vi.fn(),
      generateInstanceMailDomainDkim: vi.fn(),
      createInstanceMute: vi.fn(),
      deleteInstanceMute: vi.fn(),
    },
  };
});

import { InstanceDomains } from "./InstanceDomains.js";
import { api } from "../../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const acme = {
  domain: "acme.test",
  ownership: "CLAIMED" as const,
  organizations: [{ id: "org_1", name: "Acme" }],
  active: true,
  description: "",
  mailboxCount: 2,
  maxMailboxes: 0,
  defaultQuotaBytes: 0,
  maxQuotaBytes: 0,
  backupmx: false,
  hasDkim: true,
};

const organizations = [
  { id: "org_1", name: "Acme", memberCount: 2, domainCount: 1, createdAt: "2026-01-01" },
  { id: "org_2", name: "Beta", memberCount: 1, domainCount: 0, createdAt: "2026-01-01" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getMe.mockResolvedValue({
    user: { id: "u1", email: "admin@acme.test", isInstanceAdmin: true },
  });
  mockedApi.listInstanceMailDomains.mockResolvedValue([acme]);
  mockedApi.listInstanceOrganizations.mockResolvedValue(organizations);
  mockedApi.listInstanceMutes.mockResolvedValue([]);
  mockedApi.assignInstanceMailDomain.mockResolvedValue(acme);
});

async function openAccessDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("acme.test");
  await openRowMenu(user, "acme.test");
  await user.click(await screen.findByRole("menuitem", { name: "Manage access" }));
  return screen.findByRole("dialog");
}

describe("InstanceDomains domain access", () => {
  it("shows every organization a shared domain reaches", async () => {
    mockedApi.listInstanceMailDomains.mockResolvedValue([
      {
        ...acme,
        organizations: [
          { id: "org_1", name: "Acme" },
          { id: "org_2", name: "Beta" },
        ],
      },
    ]);
    renderWithProviders(<InstanceDomains />);

    await screen.findByText("acme.test");
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  /*
    The point of the checkbox dialog: adding a second org is one write, and the
    org already holding the domain stays ticked rather than being replaced.
  */
  it("adds a second organization without dropping the first", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceDomains />);

    const dialog = await openAccessDialog(user);
    expect(within(dialog).getByLabelText("Acme")).toBeChecked();
    expect(within(dialog).getByLabelText("Beta")).not.toBeChecked();

    await user.click(within(dialog).getByLabelText("Beta"));
    await user.click(within(dialog).getByRole("button", { name: /Save access/i }));

    await waitFor(() =>
      expect(mockedApi.assignInstanceMailDomain).toHaveBeenCalledWith(
        "acme.test",
        ["org_1", "org_2"]
      )
    );
  });

  it("hands the domain back to the instance when every box is cleared", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceDomains />);

    const dialog = await openAccessDialog(user);
    await user.click(within(dialog).getByLabelText("Acme"));
    await user.click(within(dialog).getByRole("button", { name: /Save access/i }));

    // An empty set, not a null: the domain reaches nobody afterwards.
    await waitFor(() =>
      expect(mockedApi.assignInstanceMailDomain).toHaveBeenCalledWith(
        "acme.test",
        []
      )
    );
  });

  it("labels a domain no organization reaches", async () => {
    mockedApi.listInstanceMailDomains.mockResolvedValue([
      { ...acme, ownership: "UNCLAIMED" as const, organizations: [] },
    ]);
    renderWithProviders(<InstanceDomains />);

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
  });
});
