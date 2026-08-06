import { describe, expect, it } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { assertMayUseConnection } from "./send-as.js";

const base = { organizationId: "org_1", smtpConnectionId: "s1" };

describe("assertMayUseConnection", () => {
  it("passes without any lookup when there is no acting user (API key / SYSTEM)", async () => {
    await expect(
      assertMayUseConnection({ ...base, userId: null })
    ).resolves.toBeUndefined();
    expect(prismaMock.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it("allows OWNER and ADMIN without a grant lookup", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      prismaMock.organizationMember.findUnique.mockResolvedValue({
        role,
      } as never);
      await expect(
        assertMayUseConnection({ ...base, userId: "user_1" })
      ).resolves.toBeUndefined();
    }
    expect(prismaMock.smtpConnectionGrant.findUnique).not.toHaveBeenCalled();
  });

  it("allows a MEMBER holding a grant for the connection", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue({
      id: "g1",
    } as never);

    await expect(
      assertMayUseConnection({ ...base, userId: "user_1" })
    ).resolves.toBeUndefined();
    expect(prismaMock.smtpConnectionGrant.findUnique).toHaveBeenCalledWith({
      where: {
        smtpConnectionId_userId: { smtpConnectionId: "s1", userId: "user_1" },
      },
      select: { id: true },
    });
  });

  it("throws 403 send_as_denied for a MEMBER without a grant", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue(null);

    await expect(
      assertMayUseConnection({ ...base, userId: "user_1" })
    ).rejects.toMatchObject({ statusCode: 403, code: "send_as_denied" });
  });

  it("resolves the org default connection when none is named", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue({
      id: "default_1",
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue({
      id: "g1",
    } as never);

    await assertMayUseConnection({ organizationId: "org_1", userId: "user_1" });

    expect(prismaMock.smtpConnectionGrant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          smtpConnectionId_userId: {
            smtpConnectionId: "default_1",
            userId: "user_1",
          },
        },
      })
    );
  });

  it("passes when no default connection exists (downstream 404 is clearer)", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);

    await expect(
      assertMayUseConnection({ organizationId: "org_1", userId: "user_1" })
    ).resolves.toBeUndefined();
  });

  it("throws 403 for a non-member", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    await expect(
      assertMayUseConnection({ ...base, userId: "user_1" })
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
