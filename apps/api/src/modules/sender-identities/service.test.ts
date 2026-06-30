import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { senderIdentityService } from "./service.js";

const createInput = {
  organizationId: "org_1",
  sendingDomainId: "d1",
  fromName: "Acme",
  fromEmail: "noreply@acme.com",
  smtpConnectionId: "s1",
  replyTo: "hello@acme.com"
};

beforeEach(() => {
  // Happy-path lookups: domain hosts the email, smtp belongs to the org, and
  // there is no existing default identity.
  prismaMock.sendingDomain.findFirst.mockResolvedValue({
    id: "d1",
    domain: "acme.com"
  } as never);
  prismaMock.sMTPConnection.findFirst.mockResolvedValue({ id: "s1" } as never);
  prismaMock.senderIdentity.findFirst.mockResolvedValue(null);
});

describe("senderIdentityService.create", () => {
  it("creates the first identity as default and stores its fields", async () => {
    prismaMock.senderIdentity.create.mockResolvedValue({ id: "i1" } as never);
    await senderIdentityService.create(createInput);
    const data = prismaMock.senderIdentity.create.mock.calls[0][0].data;
    expect(data.isDefault).toBe(true);
    expect(data.fromEmail).toBe("noreply@acme.com");
    expect(data.replyTo).toBe("hello@acme.com");
  });

  it("clears other defaults when explicitly default", async () => {
    prismaMock.senderIdentity.create.mockResolvedValue({ id: "i1" } as never);
    await senderIdentityService.create({ ...createInput, isDefault: true });
    expect(prismaMock.senderIdentity.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      data: { isDefault: false }
    });
  });

  it("rejects a From address not on the sending domain", async () => {
    await expect(
      senderIdentityService.create({
        ...createInput,
        fromEmail: "noreply@other.com"
      })
    ).rejects.toThrow(/must be on the sending domain/);
    expect(prismaMock.senderIdentity.create).not.toHaveBeenCalled();
  });

  it("rejects a sending domain outside the org", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue(null);
    await expect(senderIdentityService.create(createInput)).rejects.toThrow(
      /Sending domain not found/
    );
  });

  it("rejects an SMTP connection outside the org", async () => {
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    await expect(senderIdentityService.create(createInput)).rejects.toThrow(
      /SMTP connection not found/
    );
  });

  it("maps the duplicate From-address violation to a 409", async () => {
    prismaMock.senderIdentity.create.mockRejectedValue({ code: "P2002" });
    await expect(senderIdentityService.create(createInput)).rejects.toMatchObject({
      statusCode: 409
    });
  });
});

describe("senderIdentityService.get / update / delete", () => {
  it("throws 404 getting an identity the user does not own", async () => {
    prismaMock.senderIdentity.findFirst.mockResolvedValue(null);
    await expect(senderIdentityService.get("i1", "user_1")).rejects.toThrow(
      "Sender identity not found"
    );
  });

  it("updates an owned identity and keeps its default when unspecified", async () => {
    prismaMock.senderIdentity.findFirst.mockResolvedValue({
      id: "i1",
      organizationId: "org_1",
      isDefault: true
    } as never);
    prismaMock.senderIdentity.update.mockResolvedValue({ id: "i1" } as never);
    await senderIdentityService.update("i1", "user_1", { fromName: "Renamed" });
    const data = prismaMock.senderIdentity.update.mock.calls[0][0].data;
    expect(data.fromName).toBe("Renamed");
    expect(data.isDefault).toBe(true);
  });

  it("throws 404 deleting an identity the user does not own", async () => {
    prismaMock.senderIdentity.findFirst.mockResolvedValue(null);
    await expect(senderIdentityService.delete("i1", "user_1")).rejects.toThrow(
      HttpError
    );
  });
});
