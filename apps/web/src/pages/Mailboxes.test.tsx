import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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
    render(<Mailboxes />);
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
    render(<Mailboxes />);
    expect(
      await screen.findByText("Mailcow is not connected")
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
    render(<Mailboxes />);
    expect(
      await screen.findByText(/configured but unreachable/i)
    ).toBeInTheDocument();
  });

  it("provisions a mailbox and shows the one-time password", async () => {
    const user = userEvent.setup();
    render(<Mailboxes />);

    await user.type(await screen.findByLabelText("Address"), "new");
    await user.click(
      screen.getByRole("button", { name: /Provision mailbox/i })
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
    expect(screen.getByText(/shown only this once/i)).toBeInTheDocument();
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
    render(<Mailboxes />);

    await user.type(await screen.findByLabelText("Address"), "new");
    await user.click(
      screen.getByRole("button", { name: /Provision mailbox/i })
    );

    // The password dialog still opens (provisioning succeeded)...
    expect(
      await screen.findByText("generated-password-123")
    ).toBeInTheDocument();
    // ...with the not-yet-verified warning attached.
    expect(screen.getByText(/haven't verified yet/i)).toBeInTheDocument();
  });

  it("lists grants per connection and removes one", async () => {
    const user = userEvent.setup();
    render(<Mailboxes />);

    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    expect(screen.getByText("Ama")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Remove send-as for ama@acme.test"));
    await waitFor(() =>
      expect(mockedApi.removeConnectionGrant).toHaveBeenCalledWith(
        "s1",
        "user_ama"
      )
    );
    expect(screen.queryByText("Ama")).not.toBeInTheDocument();
  });

  it("keeps the grant button disabled until a member is picked", async () => {
    render(<Mailboxes />);
    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Grant send-as/i })
    ).toBeDisabled();
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
    render(<Mailboxes />);

    expect(await screen.findByText("Domain access")).toBeInTheDocument();
    // The admin row lists their granted domain as a removable chip.
    expect(
      screen.getByLabelText("Remove acme.test for admin@acme.test")
    ).toBeInTheDocument();

    await user.click(
      screen.getByLabelText("Remove acme.test for admin@acme.test")
    );
    await waitFor(() =>
      expect(mockedApi.removeMailDomainGrant).toHaveBeenCalledWith(
        "dg_1",
        "org_1"
      )
    );
  });

  it("hides the Domain access editor from admins", async () => {
    render(<Mailboxes />); // default session role is ADMIN
    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    expect(screen.queryByText("Domain access")).not.toBeInTheDocument();
    expect(mockedApi.listMailDomainGrants).not.toHaveBeenCalled();
  });

  it("tells an admin with no granted domains to ask the owner", async () => {
    mockedApi.getMailcowStatus.mockResolvedValue({
      ...status,
      domains: [],
      restricted: true,
    });
    render(<Mailboxes />);
    expect(
      await screen.findByText(/granted you access to any domains/i)
    ).toBeInTheDocument();
  });
});
