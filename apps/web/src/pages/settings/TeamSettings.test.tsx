import {
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
  // Used by actions that report progress before their result.
  loading: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

type SessionValue = {
  user: { id: string; email: string };
  currentOrganizationId?: string;
  currentOrganization?: { id: string; name: string; role: string };
};

const sessionRef = vi.hoisted(() => ({ current: {} as SessionValue }));
vi.mock("../../lib/session-context.js", () => ({
  useSession: () => sessionRef.current,
}));

vi.mock("../../lib/api.js", () => ({
  api: {
    listOrganizationMembers: vi.fn(),
    listInvites: vi.fn(),
    listSendableSMTPConnections: vi.fn(),
    createInvite: vi.fn(),
    revokeInvite: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
    requestPasswordReset: vi.fn(),
  },
}));

import { TeamSettings } from "./TeamSettings.js";
import { api } from "../../lib/api.js";

const mockedApi = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const members = [
  {
    id: "m1",
    organizationId: "org_1",
    userId: "user_1",
    role: "OWNER",
    createdAt: "2026-01-01",
    user: { id: "user_1", email: "me@x.com", name: "Me" },
  },
  {
    id: "m2",
    organizationId: "org_1",
    userId: "user_2",
    role: "MEMBER",
    createdAt: "2026-01-01",
    user: { id: "user_2", email: "teammate@x.com", name: null },
  },
];

const invites = [
  {
    id: "inv_1",
    organizationId: "org_1",
    email: "pending@x.com",
    role: "MEMBER",
    status: "PENDING",
    expiresAt: "2999-01-01",
    acceptedAt: null,
    createdAt: "2026-01-01",
    invitedBy: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  sessionRef.current = {
    user: { id: "user_1", email: "me@x.com" },
    currentOrganizationId: "org_1",
    currentOrganization: { id: "org_1", name: "Acme", role: "OWNER" },
  };
  mockedApi.listOrganizationMembers.mockResolvedValue(members);
  mockedApi.listInvites.mockResolvedValue(invites);
  mockedApi.listSendableSMTPConnections.mockResolvedValue([]);
});

describe("TeamSettings", () => {
  it("lets an administrator request a sign-in reset email for a teammate", async () => {
    mockedApi.requestPasswordReset.mockResolvedValue({ message: "Requested" });
    renderWithProviders(<TeamSettings />);
    const email = await screen.findByText("teammate@x.com");
    await userEvent.click(
      within(email.closest("li")!).getByRole("button", {
        name: "Send sign-in reset link",
      })
    );
    await waitFor(() =>
      expect(mockedApi.requestPasswordReset).toHaveBeenCalledWith({
        email: "teammate@x.com",
      })
    );
  });
  it("tells a member why the page is empty rather than rendering nothing", () => {
    sessionRef.current = {
      ...sessionRef.current,
      currentOrganization: { id: "org_1", name: "Acme", role: "MEMBER" },
    };
    renderWithProviders(<TeamSettings />);

    // A blank page after a tap reads as a bug; the page still has a header and
    // says who this is for.
    expect(screen.getByText("Owners and admins only")).toBeInTheDocument();
    expect(mockedApi.listOrganizationMembers).not.toHaveBeenCalled();
  });

  it("loads and lists members and pending invitations", async () => {
    renderWithProviders(<TeamSettings />);
    expect(await screen.findByText("teammate@x.com")).toBeInTheDocument();
    expect(screen.getByText("pending@x.com")).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });

  it("creates an invitation and reveals the accept link", async () => {
    mockedApi.createInvite.mockResolvedValue({
      invite: {
        id: "inv_2",
        organizationId: "org_1",
        email: "friend@x.com",
        role: "MEMBER",
        status: "PENDING",
        expiresAt: "2999-01-01",
        acceptedAt: null,
        createdAt: "2026-01-01",
        invitedBy: null,
      },
      emailQueued: true,
      acceptUrl: "http://localhost:5173/accept-invite?token=xyz",
    });

    renderWithProviders(<TeamSettings />);
    await screen.findByText("teammate@x.com");
    await userEvent.type(
      screen.getByLabelText("Invite by email"),
      "friend@x.com"
    );
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() =>
      expect(mockedApi.createInvite).toHaveBeenCalledWith({
        organizationId: "org_1",
        email: "friend@x.com",
        role: "MEMBER",
      })
    );
    expect(
      await screen.findByText(/accept-invite\?token=xyz/)
    ).toBeInTheDocument();
  });

  it("copies the accept link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mockedApi.createInvite.mockResolvedValue({
      invite: {
        id: "inv_2",
        organizationId: "org_1",
        email: "friend@x.com",
        role: "MEMBER",
        status: "PENDING",
        expiresAt: "2999-01-01",
        acceptedAt: null,
        createdAt: "2026-01-01",
        invitedBy: null,
      },
      acceptUrl: "http://localhost:5173/accept-invite?token=abc",
    });

    renderWithProviders(<TeamSettings />);
    await screen.findByText("teammate@x.com");
    await userEvent.type(
      screen.getByLabelText("Invite by email"),
      "friend@x.com"
    );
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await screen.findByText(/accept-invite\?token=abc/);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "http://localhost:5173/accept-invite?token=abc"
      )
    );
  });

  it("revokes a pending invitation", async () => {
    mockedApi.revokeInvite.mockResolvedValue({});
    renderWithProviders(<TeamSettings />);
    await screen.findByText("pending@x.com");
    await userEvent.click(
      screen.getByRole("button", {
        name: /Revoke invitation for pending@x.com/,
      })
    );
    await waitFor(() =>
      expect(mockedApi.revokeInvite).toHaveBeenCalledWith("inv_1")
    );
  });

  it("removes a member after confirming", async () => {
    mockedApi.removeMember.mockResolvedValue(undefined);
    renderWithProviders(<TeamSettings />);
    await screen.findByText("teammate@x.com");
    await userEvent.click(
      screen.getByRole("button", { name: /Remove teammate@x.com/ })
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove member" })
    );
    await waitFor(() =>
      expect(mockedApi.removeMember).toHaveBeenCalledWith("org_1", "user_2")
    );
  });

  it("cannot remove the last owner", async () => {
    mockedApi.listOrganizationMembers.mockResolvedValue([members[0]]);
    renderWithProviders(<TeamSettings />);
    await screen.findByText("me@x.com");

    expect(
      screen.getByRole("button", { name: /Remove me@x.com/ })
    ).toBeDisabled();
  });

  it("changes a member's role", async () => {
    mockedApi.updateMemberRole.mockResolvedValue({
      ...members[1],
      role: "ADMIN",
    });
    renderWithProviders(<TeamSettings />);
    await screen.findByText("teammate@x.com");

    await userEvent.click(screen.getByLabelText("Role for teammate@x.com"));
    await userEvent.click(await screen.findByRole("option", { name: "Admin" }));

    await waitFor(() =>
      expect(mockedApi.updateMemberRole).toHaveBeenCalledWith(
        "org_1",
        "user_2",
        "ADMIN"
      )
    );
  });

  it("surfaces a load error", async () => {
    mockedApi.listOrganizationMembers.mockRejectedValue(new Error("boom"));
    renderWithProviders(<TeamSettings />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
  });
});

it("renews an expired invitation and describes email failure without claiming delivery", async () => {
  mockedApi.listInvites.mockResolvedValue([
    { ...invites[0], expiresAt: "2020-01-01" },
  ]);
  mockedApi.createInvite.mockResolvedValue({
    invite: invites[0],
    acceptUrl: "http://localhost/accept-invite?token=renewed",
    emailQueued: false,
  });
  renderWithProviders(<TeamSettings />);
  expect(
    await screen.findByText("Expired — resend to renew")
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Resend invitation to pending@x.com" })
  );
  await waitFor(() =>
    expect(mockedApi.createInvite).toHaveBeenCalledWith({
      organizationId: "org_1",
      email: "pending@x.com",
      role: "MEMBER",
    })
  );
  expect(
    await screen.findByText(/Share this link directly or try resending/)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "assign a mailbox" })
  ).toHaveAttribute("href", "/settings/mailboxes");
  expect(
    screen.getByText(/mailbox passwords are managed separately/)
  ).toBeInTheDocument();
});
it("retries a failed team load instead of presenting an empty team as success", async () => {
  mockedApi.listOrganizationMembers
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(members);
  renderWithProviders(<TeamSettings />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't refresh the team"
  );
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("teammate@x.com")).toBeInTheDocument();
});
it("keeps organization administrators separate from instance administrators", async () => {
  sessionRef.current.currentOrganization!.role = "ADMIN";
  mockedApi.listInvites.mockResolvedValue([{ ...invites[0], role: "OWNER" }]);
  renderWithProviders(<TeamSettings />);
  await screen.findByText("teammate@x.com");
  expect(
    screen.getByRole("button", { name: "Resend invitation to pending@x.com" })
  ).toBeDisabled();
  expect(
    screen.getByText(/Instance administration is a separate permission/)
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Instance administration/ })
  ).not.toBeInTheDocument();
});

it("removes the displayed invitation link when that invitation is revoked", async () => {
  mockedApi.createInvite.mockResolvedValue({
    invite: invites[0],
    acceptUrl: "http://localhost/accept-invite?token=discarded",
    emailQueued: false,
  });
  mockedApi.revokeInvite.mockResolvedValue({});
  renderWithProviders(<TeamSettings />);
  await screen.findByText("pending@x.com");
  await userEvent.click(
    screen.getByRole("button", { name: "Resend invitation to pending@x.com" })
  );
  await screen.findByText(/accept-invite\?token=discarded/);
  await userEvent.click(
    screen.getByRole("button", { name: "Revoke invitation for pending@x.com" })
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/accept-invite\?token=discarded/)
    ).not.toBeInTheDocument()
  );
});

it("limits admins to member invitations and prevents editing another admin", async () => {
  sessionRef.current.currentOrganization!.role = "ADMIN";
  mockedApi.listOrganizationMembers.mockResolvedValue([
    ...members,
    {
      ...members[1],
      id: "m3",
      userId: "admin_2",
      role: "ADMIN",
      user: { id: "admin_2", email: "admin@x.com", name: null },
    },
  ]);
  mockedApi.listInvites.mockResolvedValue([{ ...invites[0], role: "ADMIN" }]);
  const user = userEvent.setup();
  renderWithProviders(<TeamSettings />);
  await screen.findByText("admin@x.com");
  expect(
    screen.queryByRole("combobox", { name: "Role for admin@x.com" })
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove admin@x.com" })
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Resend invitation to pending@x.com" })
  ).toBeDisabled();
  await user.click(screen.getByRole("combobox", { name: "Role" }));
  expect(screen.getByRole("option", { name: "Member" })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Admin" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Owner" })
  ).not.toBeInTheDocument();
});

describe("assign mailboxes with an invitation", () => {
  const mailboxes = [
    { id: "smtp1", fromEmail: "support@example.com" },
    { id: "smtp2", fromEmail: "sales@example.com" },
  ];
  beforeEach(() => {
    mockedApi.listSendableSMTPConnections.mockResolvedValue(mailboxes);
    mockedApi.createInvite.mockResolvedValue({
      invite: { ...invites[0], smtpConnectionIds: ["smtp1"] },
      acceptUrl: "https://example.com/accept-invite?token=ready",
      emailQueued: true,
    });
  });
  it("sends selected mailbox IDs with the invitation and clears them after success", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamSettings />);
    const support = await screen.findByRole("checkbox", {
      name: "support@example.com",
    });
    await user.click(support);
    await user.click(
      screen.getByRole("checkbox", { name: "sales@example.com" })
    );
    await user.type(
      screen.getByLabelText("Invite by email"),
      "new@example.com"
    );
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(mockedApi.createInvite).toHaveBeenCalledWith({
        organizationId: "org_1",
        email: "new@example.com",
        role: "MEMBER",
        smtpConnectionIds: ["smtp1", "smtp2"],
      })
    );
    await waitFor(() =>
      expect(support).toHaveAttribute("aria-checked", "false")
    );
  });
  it("shows saved assignments and preserves them on resend", async () => {
    mockedApi.listInvites.mockResolvedValue([
      { ...invites[0], smtpConnectionIds: ["smtp2"] },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<TeamSettings />);
    expect(
      await screen.findByText(/Mailboxes: sales@example.com/)
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Resend invitation to pending@x.com" })
    );
    await waitFor(() =>
      expect(mockedApi.createInvite).toHaveBeenCalledWith({
        organizationId: "org_1",
        email: "pending@x.com",
        role: "MEMBER",
        smtpConnectionIds: ["smtp2"],
      })
    );
  });
  it("keeps mailbox choices when creating an invitation fails", async () => {
    mockedApi.createInvite.mockRejectedValueOnce(new Error("Try again"));
    const user = userEvent.setup();
    renderWithProviders(<TeamSettings />);
    const support = await screen.findByRole("checkbox", {
      name: "support@example.com",
    });
    await user.click(support);
    await user.type(
      screen.getByLabelText("Invite by email"),
      "new@example.com"
    );
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Try again"));
    expect(support).toHaveAttribute("aria-checked", "true");
  });
  it("explains automatic owner/admin access instead of offering member assignments", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamSettings />);
    await screen.findByRole("checkbox", { name: "support@example.com" });
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(screen.getByRole("option", { name: "Admin" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Owners and admins start with access to all mailboxes/)
    ).toBeInTheDocument();
  });
  it("offers a retry when mailboxes fail to load", async () => {
    mockedApi.listSendableSMTPConnections.mockRejectedValueOnce(
      new Error("Offline")
    );
    const user = userEvent.setup();
    renderWithProviders(<TeamSettings />);
    await user.click(
      await screen.findByRole("button", { name: "Retry mailboxes" })
    );
    expect(
      await screen.findByRole("checkbox", { name: "support@example.com" })
    ).toBeInTheDocument();
  });
});
