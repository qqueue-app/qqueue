import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { mailPreferenceService } from "./service.js";
const input = {
  smtpConnectionId: "smtp1",
  text: "Ama\nCustomer care",
  enabled: true,
  expectedRevision: 0,
};
beforeEach(() => {
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
  prismaMock.sMTPConnection.findFirst.mockResolvedValue({
    id: "smtp1",
  } as never);
  prismaMock.mailSignature.findUnique.mockResolvedValue(null);
  prismaMock.mailSignature.create.mockResolvedValue({
    id: "sig1",
    revision: 1,
    ...input,
  } as never);
});
describe("personal mail signatures", () => {
  it("lists only the caller's signatures on assigned sending accounts", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
      { smtpConnectionId: "smtp1" },
    ] as never);
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      {
        id: "smtp1",
        fromEmail: "support@example.com",
        fromName: "Support",
        isDefault: true,
        mailSignatures: [{ text: "Ama", enabled: true, revision: 2 }],
      },
    ] as never);
    expect(await mailPreferenceService.signatures("org1", "u1")).toEqual([
      {
        smtpConnectionId: "smtp1",
        fromEmail: "support@example.com",
        fromName: "Support",
        isDefault: true,
        text: "Ama",
        enabled: true,
        revision: 2,
      },
    ]);
    expect(prismaMock.sMTPConnection.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org1", id: { in: ["smtp1"] } },
      select: { mailSignatures: { where: { userId: "u1" } } },
    });
  });
  it("provides empty disabled preferences for an existing sending account on upgrade", async () => {
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      {
        id: "smtp1",
        fromEmail: "support@example.com",
        fromName: null,
        isDefault: true,
        mailSignatures: [],
      },
    ] as never);
    expect(
      (await mailPreferenceService.signatures("org1", "u1"))[0]
    ).toMatchObject({ text: "", enabled: false, revision: 0 });
  });
  it("creates a personal signature and recovers the same lost-response retry", async () => {
    await mailPreferenceService.saveSignature("org1", "u1", input);
    expect(prismaMock.mailSignature.create).toHaveBeenCalledWith({
      data: {
        text: input.text,
        enabled: true,
        userId: "u1",
        organizationId: "org1",
        smtpConnectionId: "smtp1",
      },
    });
    prismaMock.mailSignature.findUnique.mockResolvedValue({
      revision: 1,
      text: input.text,
      enabled: true,
    } as never);
    await mailPreferenceService.saveSignature("org1", "u1", input);
    expect(prismaMock.mailSignature.create).toHaveBeenCalledOnce();
  });
  it("updates a known revision but refuses changed or stale retry content", async () => {
    prismaMock.mailSignature.findUnique.mockResolvedValue({
      revision: 2,
      text: "Saved",
      enabled: true,
    } as never);
    await mailPreferenceService.saveSignature("org1", "u1", {
      ...input,
      expectedRevision: 2,
    });
    expect(prismaMock.mailSignature.update).toHaveBeenCalledWith({
      where: {
        userId_smtpConnectionId: { userId: "u1", smtpConnectionId: "smtp1" },
      },
      data: { text: input.text, enabled: true, revision: { increment: 1 } },
    });
    await expect(
      mailPreferenceService.saveSignature("org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("rejects a missing account or a member without its send grant", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValueOnce(null);
    await expect(
      mailPreferenceService.saveSignature("org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue(null);
    await expect(
      mailPreferenceService.saveSignature("org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
