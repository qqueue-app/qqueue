import {
  openRowMenu,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../test/render.js";
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
    listMailboxes: vi.fn(),
    listSMTPConnections: vi.fn(),
    listOrganizationMembers: vi.fn(),
    listConnectionGrants: vi.fn(),
    addConnectionGrant: vi.fn(),
    removeConnectionGrant: vi.fn(),
    provisionMailbox: vi.fn(),
    adoptMailbox: vi.fn(),
    resetMailboxPassword: vi.fn(),
    setMailboxActive: vi.fn(),
    deleteMailbox: vi.fn(),
    verifySMTPConnection: vi.fn(),
    updateSMTPConnection: vi.fn(),
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

// The grid is fed by the merged mailbox list; the connection fixtures below
// still matter, because the "Who can send" matrix is built from them.
const mailbox = {
  email: "support@acme.test",
  domain: "acme.test",
  name: "Support",
  origin: "MANAGED",
  active: true,
  quotaBytes: 0,
  usedBytes: 1536,
  smtpConnectionId: "s1",
  replyTo: null as string | null,
  host: "mail.acme.test",
  port: 465,
  isDefault: true,
};

const otherMailbox = {
  email: "billing@other.test",
  domain: "other.test",
  name: "Billing",
  origin: "MANAGED",
  active: true,
  quotaBytes: 0,
  usedBytes: 0,
  smtpConnectionId: "s2",
  replyTo: null as string | null,
  host: "mail.other.test",
  port: 465,
  isDefault: false,
};

/** On the mail server, unknown to QQueue — the case the page used to hide. */
const unconnectedMailbox = {
  email: "hello@acme.test",
  domain: "acme.test",
  name: "Hello",
  origin: "SERVER_ONLY",
  active: true,
  quotaBytes: 0,
  usedBytes: 0,
  smtpConnectionId: null,
  replyTo: null as string | null,
  host: null,
  port: null,
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
  mockedApi.listMailboxes.mockResolvedValue([mailbox]);
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
  mockedApi.adoptMailbox.mockResolvedValue({
    smtpConnection: { ...connection, id: "s3", fromEmail: "hello@acme.test" },
    inboxAccountId: "inbox_2",
    email: "hello@acme.test",
    verified: true,
  });
  mockedApi.resetMailboxPassword.mockResolvedValue({
    email: "support@acme.test",
    mailboxPassword: "rotated-password-456",
  });
  mockedApi.setMailboxActive.mockResolvedValue({
    email: "support@acme.test",
    active: false,
  });
  mockedApi.deleteMailbox.mockResolvedValue({
    email: "support@acme.test",
    smtpConnectionDeleted: true,
    inboxAccountDisabled: true,
  });
  mockedApi.updateSMTPConnection.mockResolvedValue(connection);
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

  /*
    Domain access moved out. Both the Domains tab and the per-admin Domain
    access editor now live under /settings/instance, behind isInstanceAdmin —
    a Mailcow domain is instance-global, and org OWNER is a role any user can
    award themselves by creating an organization. Owners see exactly what
    admins see here.
  */
  it("no longer offers domain management to owners", async () => {
    session.current = {
      currentOrganizationId: "org_1",
      currentOrganization: { id: "org_1", name: "Acme", role: "OWNER" },
    };
    renderWithProviders(<Mailboxes />);

    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Domain access/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /^Domains$/ })
    ).not.toBeInTheDocument();
  });

  it("hides the Domain access tab from admins", async () => {
    renderWithProviders(<Mailboxes />); // default session role is ADMIN
    expect(await screen.findByText("support@acme.test")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /Domain access/ })
    ).not.toBeInTheDocument();
  });

  // Domain-scoped management: pick a domain, see only its mailboxes, and add
  // the next one straight onto it.
  it("narrows the list to the chosen domain", async () => {
    const user = userEvent.setup();
    mockedApi.listMailboxes.mockResolvedValue([mailbox, otherMailbox]);
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
    mockedApi.listMailboxes.mockResolvedValue([mailbox, otherMailbox]);
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

  // The whole point of the merged list: a mailbox made in the Mailcow UI is
  // real mail arriving, so the page has to admit it exists.
  it("lists mailboxes the mail server has but QQueue does not", async () => {
    mockedApi.listMailboxes.mockResolvedValue([mailbox, unconnectedMailbox]);
    renderWithProviders(<Mailboxes />);

    expect(await screen.findByText("hello@acme.test")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("connects a mailbox that already exists on the server", async () => {
    const user = userEvent.setup();
    mockedApi.listMailboxes.mockResolvedValue([mailbox, unconnectedMailbox]);
    renderWithProviders(<Mailboxes />);

    await screen.findByText("hello@acme.test");
    // The access column fills in from a second, per-connection query, and that
    // resolution remounts the rows. Wait for it, or the menu trigger is a
    // detached node by the time it gets clicked.
    await screen.findByText("+1");
    await user.click(
      screen.getByRole("button", { name: "Connect to QQueue" })
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /Connect mailbox/i })
    );

    await waitFor(() =>
      expect(mockedApi.adoptMailbox).toHaveBeenCalledWith(
        "hello@acme.test",
        // The mail server's own name for the mailbox seeds the From line.
        expect.objectContaining({ organizationId: "org_1", name: "Hello" })
      )
    );
  });

  /*
    Reply-To lives on the sending account, so editing it is an account write,
    not a mail-server one: it must not need Mailcow, and it must reach the
    EXTERNAL rows that have no mailbox behind them at all.
  */
  it("edits a mailbox's display name and Reply-To", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);

    await screen.findByText("support@acme.test");
    await screen.findByText("+1");
    await user.click(screen.getByRole("button", { name: "Edit mailbox" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Reply-To (optional)"),
      "replies@acme.test"
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Save mailbox/i })
    );

    await waitFor(() =>
      expect(mockedApi.updateSMTPConnection).toHaveBeenCalledWith("s1", {
        organizationId: "org_1",
        fromName: "Support",
        replyTo: "replies@acme.test",
      })
    );
  });

  it("clears a Reply-To by emptying the field", async () => {
    const user = userEvent.setup();
    mockedApi.listMailboxes.mockResolvedValue([
      { ...mailbox, replyTo: "replies@acme.test" },
    ]);
    renderWithProviders(<Mailboxes />);

    await screen.findByText("support@acme.test");
    await screen.findByText("+1");
    await user.click(screen.getByRole("button", { name: "Edit mailbox" }));

    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Reply-To (optional)"));
    await user.click(
      within(dialog).getByRole("button", { name: /Save mailbox/i })
    );

    // "" and not an omitted key: the API reads a missing field as "unchanged".
    await waitFor(() =>
      expect(mockedApi.updateSMTPConnection).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ replyTo: "" })
      )
    );
  });

  it("offers no mailbox editor for a row QQueue has no account for", async () => {
    const user = userEvent.setup();
    mockedApi.listMailboxes.mockResolvedValue([mailbox, unconnectedMailbox]);
    renderWithProviders(<Mailboxes />);

    await screen.findByText("hello@acme.test");
    await screen.findByText("+1");
    await openRowMenu(user, "hello@acme.test");

    expect(
      screen.queryByRole("menuitem", { name: "Edit mailbox" })
    ).not.toBeInTheDocument();
  });

  it("resets a mailbox password and shows it exactly once", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);

    await screen.findByText("support@acme.test");
    // The access column fills in from a second, per-connection query, and that
    // resolution remounts the rows. Wait for it, or the menu trigger is a
    // detached node by the time it gets clicked.
    await screen.findByText("+1");
    await openRowMenu(user, "support@acme.test");
    await user.click(
      await screen.findByRole("menuitem", { name: /Reset password/i })
    );

    // Locking someone out of their mail app is worth an "are you sure".
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: "Reset password" })
    );

    await waitFor(() =>
      expect(mockedApi.resetMailboxPassword).toHaveBeenCalledWith(
        "support@acme.test",
        "org_1"
      )
    );
    expect(await screen.findByText("rotated-password-456")).toBeInTheDocument();
    // Reassures the admin that sending kept working through the rotation.
    expect(
      screen.getByText(/separate password of QQueue's own/i)
    ).toBeInTheDocument();
  });

  it("confirms before deleting a mailbox, then reports what was kept", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Mailboxes />);

    await screen.findByText("support@acme.test");
    // The access column fills in from a second, per-connection query, and that
    // resolution remounts the rows. Wait for it, or the menu trigger is a
    // detached node by the time it gets clicked.
    await screen.findByText("+1");
    await openRowMenu(user, "support@acme.test");
    await user.click(
      await screen.findByRole("menuitem", { name: /Delete mailbox/i })
    );
    expect(mockedApi.deleteMailbox).not.toHaveBeenCalled();

    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: "Delete mailbox" })
    );

    await waitFor(() =>
      expect(mockedApi.deleteMailbox).toHaveBeenCalledWith(
        "support@acme.test",
        "org_1"
      )
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("already synced into QQueue is kept")
      )
    );
  });

  // Switching a mailbox off loses mail, so it confirms; switching it back on
  // only restores the status quo and goes straight through.
  it("resumes delivery without a confirmation step", async () => {
    const user = userEvent.setup();
    mockedApi.listMailboxes.mockResolvedValue([{ ...mailbox, active: false }]);
    mockedApi.setMailboxActive.mockResolvedValue({
      email: "support@acme.test",
      active: true,
    });
    renderWithProviders(<Mailboxes />);

    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    // The access column fills in from a second, per-connection query, and that
    // resolution remounts the rows. Wait for it, or the menu trigger is a
    // detached node by the time it gets clicked.
    await screen.findByText("+1");
    await openRowMenu(user, "support@acme.test");
    await user.click(
      await screen.findByRole("menuitem", { name: /Resume delivery/i })
    );

    await waitFor(() =>
      expect(mockedApi.setMailboxActive).toHaveBeenCalledWith(
        "support@acme.test",
        "org_1",
        true
      )
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("offers no mail-server actions for a hand-added sending account", async () => {
    const user = userEvent.setup();
    mockedApi.listMailboxes.mockResolvedValue([
      {
        ...mailbox,
        email: "ses@acme.test",
        origin: "EXTERNAL",
        active: null,
        quotaBytes: null,
        usedBytes: null,
      },
    ]);
    renderWithProviders(<Mailboxes />);

    await screen.findByText("ses@acme.test");
    // The access column fills in from a second, per-connection query, and that
    // resolution remounts the rows. Wait for it, or the menu trigger is a
    // detached node by the time it gets clicked.
    await screen.findByText("+1");
    await openRowMenu(user, "ses@acme.test");

    expect(
      await screen.findByRole("menuitem", { name: /Copy address/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Reset password/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Delete mailbox/i })
    ).not.toBeInTheDocument();
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
