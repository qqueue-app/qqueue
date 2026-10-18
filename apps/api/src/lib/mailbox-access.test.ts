import { describe, expect, it } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import {
  assertMailboxNotRevoked,
  resolveMailboxAccess,
  inboundMessageScope,
  emailJobScope,
  assertInboxAccountAccess,
} from "./mailbox-access.js";

describe("owner-controlled admin mailbox access", () => {
  it("keeps owners unrestricted without consulting grants", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER",
    } as never);
    expect((await resolveMailboxAccess("owner", "org")).unrestricted).toBe(
      true
    );
    expect(prismaMock.inboxAccountGrant.findMany).not.toHaveBeenCalled();
  });
  it("preserves implicit admin access when no mailbox has been revoked", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
    expect((await resolveMailboxAccess("admin", "org")).unrestricted).toBe(
      true
    );
  });
  it("excludes revoked accounts from admin reading, outgoing scopes and account actions", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([
      { inboxAccountId: "private-inbox" },
    ] as never);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
      { smtpConnectionId: "private-smtp" },
    ] as never);
    prismaMock.inboxAccount.findMany.mockResolvedValue([
      { id: "support-inbox" },
    ] as never);
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      { id: "support-smtp" },
    ] as never);
    const access = await resolveMailboxAccess("admin", "org");
    expect(access.unrestricted).toBe(false);
    expect(inboundMessageScope(access)).toEqual({
      inboxAccountId: { in: ["support-inbox"] },
    });
    expect(emailJobScope(access)).toEqual({
      AND: [
        {
          OR: [
            { smtpConnectionId: { in: ["support-smtp"] } },
            { createdByUserId: "admin" },
          ],
        },
        {
          OR: [
            { smtpConnectionId: null },
            { smtpConnectionId: { notIn: ["private-smtp"] } },
          ],
        },
      ],
    });
    expect(() => assertInboxAccountAccess(access, "private-inbox")).toThrow(
      "You do not have access to this mailbox"
    );
    expect(prismaMock.inboxAccount.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org", id: { notIn: ["private-inbox"] } },
      select: { id: true },
    });
    expect(prismaMock.sMTPConnection.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org", id: { notIn: ["private-smtp"] } },
      select: { id: true },
    });
  });
  it("does not treat denial rows as member grants after demotion", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
    expect(
      (await resolveMailboxAccess("member", "org")).inboxAccountIds
    ).toEqual([]);
    expect(prismaMock.inboxAccountGrant.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org", userId: "member", revoked: false },
      select: { inboxAccountId: true },
    });
  });
  it("rejects nonmembers", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    await expect(resolveMailboxAccess("outsider", "org")).rejects.toMatchObject(
      { statusCode: 403 }
    );
    await expect(
      assertMailboxNotRevoked("outsider", "org", "private@example.test")
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["smtp", "inbox"])(
    "blocks credential recovery or reconnect through a %s denial",
    async (side) => {
      prismaMock.organizationMember.findUnique.mockResolvedValue({
        role: "ADMIN",
      } as never);
      if (side === "smtp")
        prismaMock.smtpConnectionGrant.findFirst.mockResolvedValue({
          id: "denied",
        } as never);
      else
        prismaMock.inboxAccountGrant.findFirst.mockResolvedValue({
          id: "denied",
        } as never);
      await expect(
        assertMailboxNotRevoked("admin", "org", "PRIVATE@example.test")
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "mailbox_access_denied",
      });
      expect(prismaMock.smtpConnectionGrant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            revoked: true,
            userId: "admin",
            organizationId: "org",
            smtpConnection: {
              fromEmail: {
                equals: "PRIVATE@example.test",
                mode: "insensitive",
              },
            },
          }),
        })
      );
    }
  );
  it("allows owners to recover any mailbox and admins to manage allowed addresses", async () => {
    prismaMock.organizationMember.findUnique
      .mockResolvedValueOnce({ role: "OWNER" } as never)
      .mockResolvedValueOnce({ role: "ADMIN" } as never);
    await expect(
      assertMailboxNotRevoked("owner", "org", "private@example.test")
    ).resolves.toBeUndefined();
    await expect(
      assertMailboxNotRevoked("admin", "org", "support@example.test")
    ).resolves.toBeUndefined();
  });
});

describe("org-wide tools respect mailbox denials", () => {
  it.each(["smtp", "inbox"])(
    "blocks org-wide operations for a %s restriction",
    async (side) => {
      const { assertNoMailboxRestrictions } =
        await import("./mailbox-access.js");
      prismaMock.smtpConnectionGrant.count.mockResolvedValue(
        side === "smtp" ? 1 : 0
      );
      prismaMock.inboxAccountGrant.count.mockResolvedValue(
        side === "inbox" ? 1 : 0
      );
      await expect(
        assertNoMailboxRestrictions("admin", "org")
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "mailbox_access_denied",
      });
    }
  );
  it("keeps unrestricted operators and promoted owners eligible", async () => {
    const { assertNoMailboxRestrictions } = await import("./mailbox-access.js");
    prismaMock.smtpConnectionGrant.count.mockResolvedValue(0);
    prismaMock.inboxAccountGrant.count.mockResolvedValue(0);
    await expect(
      assertNoMailboxRestrictions("user", "org")
    ).resolves.toBeUndefined();
    expect(prismaMock.smtpConnectionGrant.count).toHaveBeenCalledWith({
      where: {
        organizationId: "org",
        userId: "user",
        revoked: true,
        user: { members: { none: { organizationId: "org", role: "OWNER" } } },
      },
    });
  });
});
