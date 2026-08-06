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

const session = vi.hoisted(() => ({
  current: {
    currentOrganizationId: "org_1",
    currentOrganization: { id: "org_1", name: "Acme", role: "ADMIN" },
  },
}));
vi.mock("../lib/session-context.js", () => ({
  useSession: () => session.current,
}));

vi.mock("../lib/api.js", () => ({
  api: {
    getMailcowStatus: vi.fn(),
    listSMTPConnections: vi.fn(),
    listOrganizationMembers: vi.fn(),
    listConnectionGrants: vi.fn(),
    addConnectionGrant: vi.fn(),
    removeConnectionGrant: vi.fn(),
    provisionMailbox: vi.fn(),
    listMailDomainGrants: vi.fn(),
    addMailDomainGrant: vi.fn(),
    removeMailDomainGrant: vi.fn(),
  },
}));

import { Mailboxes } from "./Mailboxes.js";
import { api } from "../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const status = {
  configured: true,
  reachable: true,
  domains: ["acme.test", "other.test"],
  mailHost: "mail.acme.test",
};

const connection = {
  id: "s1",
  organizationId: "org_1",
  name: "Support",
  host: "mail.acme.test",
  port: 465,
  secure: true,
  fromEmail: "support@acme.test",
  isDefault: true,
};

const otherConnection = {
  id: "s2",
  organizationId: "org_1",
  name: "Billing",
  host: "mail.other.test",
  port: 465,
  secure: true,
  fromEmail: "billing@other.test",
  isDefault: false,
};

const members = [
  {
    id: "m1",
    organizationId: "org_1",
    userId: "user_owner",
    role: "OWNER",
    createdAt: "2026-01-01",
    user: { id: "user_owner", email: "owner@acme.test", name: "Owner" },
  },
  {
    id: "m2",
    organizationId: "org_1",
    userId: "user_ama",
    role: "MEMBER",
    createdAt: "2026-01-01",
    user: { id: "user_ama", email: "ama@acme.test", name: "Ama" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  session.current = {
    currentOrganizationId: "org_1",
    currentOrganization: { id: "org_1", name: "Acme", role: "ADMIN" },
  };
  mockedApi.getMailcowStatus.mockResolvedValue(status);
  mockedApi.listSMTPConnections.mockResolvedValue([connection]);
  mockedApi.listOrganizationMembers.mockResolvedValue(members);
  mockedApi.listConnectionGrants.mockResolvedValue([
    {
      id: "g1",
      organizationId: "org_1",
      smtpConnectionId: "s1",
      userId: "user_ama",
      createdAt: "2026-01-02",
      user: { id: "user_ama", email: "ama@acme.test", name: "Ama" },
    },
  ]);
  mockedApi.removeConnectionGrant.mockResolvedValue(undefined);
  mockedApi.listMailDomainGrants.mockResolvedValue([]);
  mockedApi.addMailDomainGrant.mockResolvedValue({ id: "dg_1" });
  mockedApi.removeMailDomainGrant.mockResolvedValue(undefined);
  mockedApi.provisionMailbox.mockResolvedValue({
    smtpConnection: { ...connection, id: "s2", fromEmail: "new@acme.test" },
    inboxAccountId: "inbox_1",
    email: "new@acme.test",
    mailboxPassword: "generated-password-123",
    verified: true,
  });
});

describe("Mailboxes", () => {
  it("tells MEMBERs the page is owner/admin territory", async () => {
    session.current = {
      currentOrganizationId: "org_1",
      currentOrganization: { id: "org_1", name: "Acme", role: "MEMBER" },
    };
    renderWithProviders(<Mailboxes />);
    expect(
      await screen.findByText("Owners and admins only")
    ).toBeInTheDocument();
    expect(mockedApi.getMailcowStatus).not.toHaveBeenCalled();
  });

  it("explains setup when Mailcow is not configured", async () => {
    mockedApi.getMailcowStatus.mockResolvedValue({
      configured: false,
      reachable: false,
      domains: [],
      mailHost: null,
    });
    renderWithProviders(<Mailboxes />);
    expect(
      await screen.findByText("Your mail server isn't connected yet")
    ).toBeInTheDocument();
  });

  it("reports a configured but unreachable Mailcow", async () => {
    mockedApi.getMailcowStatus.mockResolvedValue({
      configured: true,
      reachable: false,
      domains: [],
      mailHost: "mail.acme.test",
      error: "connect timeout",
    });
    renderWithProviders(<Mailboxes />);
    expect(
      await screen.findByText(/couldn't reach it/i)
    ).toBeInTheDocument();
  });

  it("provisions a mailbox and shows the one-time password", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);

    await user.click(await screen.findByRole("button", { name: "New mailbox" }));
    await user.type(await screen.findByLabelText("Address"), "new");
    await user.click(
      screen.getByRole("button", { name: /Create mailbox/i })
    );

    await waitFor(() =>
      expect(mockedApi.provisionMailbox).toHaveBeenCalledWith({
        organizationId: "org_1",
        localPart: "new",
        // The first Mailcow domain is preselected.
        domain: "acme.test",
        name: undefined,
        assignToUserId: undefined,
      })
    );
    expect(
      await screen.findByText("generated-password-123")
    ).toBeInTheDocument();
    expect(screen.getByText(/shown once and\s+never again/i)).toBeInTheDocument();
    // Verified provisioning shows no credential warning.
    expect(screen.queryByText(/haven't verified yet/i)).not.toBeInTheDocument();
  });

  it("warns — without failing — when the new mailbox has not verified yet", async () => {
    const user = userEvent.setup();
    mockedApi.provisionMailbox.mockResolvedValue({
      smtpConnection: { ...connection, id: "s2", fromEmail: "new@acme.test" },
      inboxAccountId: "inbox_1",
      email: "new@acme.test",
      mailboxPassword: "generated-password-123",
      verified: false,
    });
    renderWithProviders(<Mailboxes />);

    await user.click(await screen.findByRole("button", { name: "New mailbox" }));
    await user.type(await screen.findByLabelText("Address"), "new");
    await user.click(
      screen.getByRole("button", { name: /Create mailbox/i })
    );

    // The password dialog still opens (provisioning succeeded)...
    expect(
      await screen.findByText("generated-password-123")
    ).toBeInTheDocument();
    // ...with the not-yet-verified warning attached.
    expect(screen.getByText(/haven't verified yet/i)).toBeInTheDocument();
  });

  it("shows who can send as each mailbox and revokes access from the grid", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);

    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Who can send/ }));

    // Ama is a MEMBER holding a grant, so her cell is ticked.
    const cell = await screen.findByRole("checkbox", {
      name: "Ama can send as support@acme.test",
    });
    expect(cell).toHaveAttribute("aria-checked", "true");

    await user.click(cell);
    await waitFor(() =>
      expect(mockedApi.removeConnectionGrant).toHaveBeenCalledWith(
        "s1",
        "user_ama"
      )
    );
  });

  it("locks the row for people who can always send as any mailbox", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);
    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Who can send/ }));

    // The owner needs no grant, so there is no checkbox to toggle for them.
    expect(
      screen.queryByRole("checkbox", {
        name: "Owner can send as support@acme.test",
      })
    ).not.toBeInTheDocument();
  });

  // Domain access: owners manage which domains each admin may provision on.
  it("shows owners the Domain access editor and removes a grant", async () => {
    const user = userEvent.setup();
    session.current = {
      currentOrganizationId: "org_1",
      currentOrganization: { id: "org_1", name: "Acme", role: "OWNER" },
    };
    mockedApi.listOrganizationMembers.mockResolvedValue([
      ...members,
      {
        id: "m3",
        organizationId: "org_1",
        userId: "user_admin",
        role: "ADMIN",
        createdAt: "2026-01-01",
        user: { id: "user_admin", email: "admin@acme.test", name: "Adjoa" },
      },
    ]);
    mockedApi.listMailDomainGrants.mockResolvedValue([
      {
        id: "dg_1",
        organizationId: "org_1",
        userId: "user_admin",
        domain: "acme.test",
        createdAt: "2026-01-02",
        user: { id: "user_admin", email: "admin@acme.test", name: "Adjoa" },
      },
    ]);
    renderWithProviders(<Mailboxes />);

    await user.click(
      await screen.findByRole("tab", { name: /Domain access/ })
    );
    // The admin row lists their granted domain as a removable chip.
    const remove = await screen.findByLabelText(
      "Remove acme.test from Adjoa"
    );
    await user.click(remove);
    await waitFor(() =>
      expect(mockedApi.removeMailDomainGrant).toHaveBeenCalledWith(
        "dg_1",
        "org_1"
      )
    );
  });

  it("hides the Domain access tab from admins", async () => { renderWithProviders(<Mailboxes />); // default session role is ADMIN
    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Domain access/ })
    ).not.toBeInTheDocument();
    expect(mockedApi.listMailDomainGrants).not.toHaveBeenCalled();
  });

  // Domain-scoped management: pick a domain, see only its mailboxes, and add
  // the next one straight onto it.
  it("narrows the list to the chosen domain", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([
      connection,
      otherConnection,
    ]);
    renderWithProviders(<Mailboxes />);

    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    expect(screen.getByText("billing@other.test")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Filter by domain" }));
    await user.click(
      await screen.findByRole("option", { name: "other.test (1)" })
    );

    await waitFor(() =>
      expect(screen.queryByText("support@acme.test")).not.toBeInTheDocument()
    );
    expect(screen.getByText("billing@other.test")).toBeInTheDocument();
  });

  it("creates the new mailbox on the domain being viewed", async () => {
    const user = userEvent.setup();
    mockedApi.listSMTPConnections.mockResolvedValue([
      connection,
      otherConnection,
    ]);
    renderWithProviders(<Mailboxes />);

    await user.click(
      await screen.findByRole("combobox", { name: "Filter by domain" })
    );
    await user.click(
      await screen.findByRole("option", { name: "other.test (1)" })
    );

    await user.click(screen.getByRole("button", { name: "New mailbox" }));
    await user.type(await screen.findByLabelText("Address"), "new");
    await user.click(screen.getByRole("button", { name: /Create mailbox/i }));

    await waitFor(() =>
      expect(mockedApi.provisionMailbox).toHaveBeenCalledWith(
        // The filtered domain wins over the first one in the list.
        expect.objectContaining({ localPart: "new", domain: "other.test" })
      )
    );
  });

  it("says which domain is empty rather than showing the blank-slate copy", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);

    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Filter by domain" }));
    await user.click(
      await screen.findByRole("option", { name: "other.test (0)" })
    );

    expect(
      await screen.findByText("No mailboxes on other.test")
    ).toBeInTheDocument();
    expect(screen.queryByText("No mailboxes yet")).not.toBeInTheDocument();
  });

  it("tells an admin with no granted domains to ask the owner", async () => {
    mockedApi.getMailcowStatus.mockResolvedValue({
      ...status,
      domains: [],
      restricted: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);
    await user.click(await screen.findByRole("button", { name: "New mailbox" }));
    expect(
      await screen.findByText(/don't have access to any domains/i)
    ).toBeInTheDocument();
  });
});
