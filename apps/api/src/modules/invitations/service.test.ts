import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

const providerSend = vi.fn().mockResolvedValue({
  messageId: "m",
  accepted: [],
  rejected: [],
  provider: "smtp"
});
vi.mock("../smtp-connections/service.js", () => ({
  smtpConnectionService: {
    getProviderForConnection: vi.fn(() => ({ send: providerSend }))
  }
}));

const { invitationService } = await import("./service.js");

const now = Date.now();
const future = new Date(now + 60 * 60 * 1000);
const past = new Date(now - 60 * 60 * 1000);

const smtpConnection = {
  id: "smtp_1",
  organizationId: "org_1",
  fromEmail: "no-reply@example.com",
  fromName: "QQueue",
  isDefault: true
};

beforeEach(() => {
  providerSend.mockClear();
});

describe("invitationService.create", () => {
  it("issues an invite when the actor is an OWNER and emails the link", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organizationMember.findFirst.mockResolvedValue(null);
    prismaMock.organizationInvite.create.mockResolvedValue({
      id: "inv_1",
      email: "new@example.com",
      role: "MEMBER"
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue({
      name: "Acme"
    } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(smtpConnection as never);

    const result = await invitationService.create(
      { organizationId: "org_1", email: "New@Example.com", role: "MEMBER" },
      "user_1"
    );

    expect(result.invite).toEqual({
      id: "inv_1",
      email: "new@example.com",
      role: "MEMBER"
    });
    expect(result.acceptUrl).toContain("/accept-invite?token=");
    // Email is lower-cased before persisting.
    const createArg = prismaMock.organizationInvite.create.mock.calls[0][0];
    expect(createArg.data.email).toBe("new@example.com");
    expect(providerSend).toHaveBeenCalledOnce();
  });

  it("still returns the invite when no SMTP connection exists", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN"
    } as never);
    prismaMock.organizationMember.findFirst.mockResolvedValue(null);
    prismaMock.organizationInvite.create.mockResolvedValue({
      id: "inv_2",
      email: "new@example.com",
      role: "MEMBER"
    } as never);
    prismaMock.organization.findUnique.mockResolvedValue({ name: "Acme" } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);

    const result = await invitationService.create(
      { organizationId: "org_1", email: "new@example.com", role: "MEMBER" },
      "user_1"
    );

    expect(result.acceptUrl).toContain("/accept-invite?token=");
    expect(providerSend).not.toHaveBeenCalled();
  });

  it("rejects a MEMBER actor with 403", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);

    await expect(
      invitationService.create(
        { organizationId: "org_1", email: "new@example.com", role: "MEMBER" },
        "user_1"
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("forbids an ADMIN from inviting a new OWNER", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN"
    } as never);

    await expect(
      invitationService.create(
        { organizationId: "org_1", email: "new@example.com", role: "OWNER" },
        "user_1"
      )
    ).rejects.toThrow("Only an owner can invite another owner");
  });

  it("rejects inviting someone who is already a member", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organizationMember.findFirst.mockResolvedValue({
      id: "mem_1"
    } as never);

    await expect(
      invitationService.create(
        { organizationId: "org_1", email: "already@example.com", role: "MEMBER" },
        "user_1"
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("invitationService.accept", () => {
  it("creates a new user + membership and returns tokens", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      email: "new@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: future
    } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user_9",
      email: "new@example.com",
      name: "New",
      createdAt: new Date(0)
    } as never);
    prismaMock.organizationMember.create.mockResolvedValue({} as never);
    prismaMock.organizationInvite.update.mockResolvedValue({} as never);
    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);

    const result = await invitationService.accept({
      token: "a-valid-looking-token",
      password: "password123",
      name: "New"
    });

    expect(result.requiresSignIn).toBe(false);
    expect(result.user?.id).toBe("user_9");
    expect(result.tokens?.accessToken).toEqual(expect.any(String));
    expect(prismaMock.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: "org_1", userId: "user_9", role: "MEMBER" }
    });
  });

  it("grants membership to an existing account but requires sign-in", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      email: "existing@example.com",
      role: "ADMIN",
      status: "PENDING",
      expiresAt: future
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_5",
      email: "existing@example.com"
    } as never);
    // getMembership → not yet a member
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    prismaMock.organizationMember.create.mockResolvedValue({} as never);
    prismaMock.organizationInvite.update.mockResolvedValue({} as never);
    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);

    const result = await invitationService.accept({
      token: "a-valid-looking-token"
    });

    expect(result.requiresSignIn).toBe(true);
    expect(result.alreadyMember).toBe(false);
    expect(result.tokens).toBeUndefined();
    expect(prismaMock.organizationMember.create).toHaveBeenCalled();
  });

  it("is a no-op membership grant when the account is already a member", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      email: "existing@example.com",
      role: "ADMIN",
      status: "PENDING",
      expiresAt: future
    } as never);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_5",
      email: "existing@example.com"
    } as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.organizationInvite.update.mockResolvedValue({} as never);
    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org_1",
      name: "Acme"
    } as never);

    const result = await invitationService.accept({
      token: "a-valid-looking-token"
    });

    expect(result.requiresSignIn).toBe(true);
    expect(result.alreadyMember).toBe(true);
    expect(prismaMock.organizationMember.create).not.toHaveBeenCalled();
  });

  it("rejects an expired invitation", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      email: "new@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: past
    } as never);

    await expect(
      invitationService.accept({ token: "a-valid-looking-token" })
    ).rejects.toThrow("invalid or has expired");
  });

  it("requires a password for a brand-new account", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      email: "new@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: future
    } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(
      invitationService.accept({ token: "a-valid-looking-token" })
    ).rejects.toThrow("password is required");
  });
});

describe("invitationService.lookup", () => {
  it("returns invite details and whether an account exists", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      email: "new@example.com",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: future,
      organization: { name: "Acme" }
    } as never);
    prismaMock.user.findUnique.mockResolvedValue(null);

    const result = await invitationService.lookup("a-valid-looking-token");
    expect(result).toMatchObject({
      email: "new@example.com",
      role: "MEMBER",
      organizationName: "Acme",
      hasAccount: false
    });
  });

  it("rejects an invalid token", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue(null);
    await expect(
      invitationService.lookup("nope-nope-nope-token")
    ).rejects.toThrow("invalid or has expired");
  });
});

describe("invitationService.revoke", () => {
  it("revokes a pending invitation", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      status: "PENDING"
    } as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.organizationInvite.update.mockResolvedValue({
      id: "inv_1",
      status: "REVOKED"
    } as never);

    const result = await invitationService.revoke("inv_1", "user_1");
    expect(result).toMatchObject({ status: "REVOKED" });
  });

  it("refuses to revoke an already-accepted invitation", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue({
      id: "inv_1",
      organizationId: "org_1",
      status: "ACCEPTED"
    } as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);

    await expect(
      invitationService.revoke("inv_1", "user_1")
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns 404 for a missing invitation", async () => {
    prismaMock.organizationInvite.findUnique.mockResolvedValue(null);
    await expect(
      invitationService.revoke("missing", "user_1")
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
