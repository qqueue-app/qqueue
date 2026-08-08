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
    createInvite: vi.fn(),
    revokeInvite: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
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
});

describe("TeamSettings", () => {
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
