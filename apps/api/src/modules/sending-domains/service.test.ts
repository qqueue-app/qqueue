import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { sendingDomainService } from "./service.js";

const externalInput = {
  organizationId: "org_1",
  domain: "acme.com",
  dkimMode: "EXTERNAL" as const,
  spfNote: "configured in Mailcow"
};

describe("sendingDomainService.list / get", () => {
  it("lists domains for the org", () => {
    prismaMock.sendingDomain.findMany.mockResolvedValue([] as never);
    sendingDomainService.list("org_1");
    expect(prismaMock.sendingDomain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1" } })
    );
  });

  it("gets an owned domain", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue({ id: "d1" } as never);
    prismaMock.sendingDomain.findUnique.mockResolvedValue({ id: "d1" } as never);
    const result = await sendingDomainService.get("d1", "user_1");
    expect(result).toEqual({ id: "d1" });
  });

  it("throws 404 getting a domain the user does not own", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue(null);
    await expect(sendingDomainService.get("d1", "user_1")).rejects.toThrow(
      "Sending domain not found"
    );
  });
});

describe("sendingDomainService.create", () => {
  it("creates an external-mode domain with NA dkim status", async () => {
    prismaMock.sendingDomain.create.mockResolvedValue({ id: "d1" } as never);
    await sendingDomainService.create(externalInput);
    const data = prismaMock.sendingDomain.create.mock.calls[0][0].data;
    expect(data.dkimMode).toBe("EXTERNAL");
    expect(data.dkimStatus).toBe("NA");
    expect(data.spfNote).toBe("configured in Mailcow");
  });

  it("rejects managed mode until a later sprint", async () => {
    await expect(
      sendingDomainService.create({ ...externalInput, dkimMode: "MANAGED" })
    ).rejects.toThrow(/Managed DKIM signing is not available yet/);
    expect(prismaMock.sendingDomain.create).not.toHaveBeenCalled();
  });

  it("maps the unique-domain violation to a 409", async () => {
    prismaMock.sendingDomain.create.mockRejectedValue({ code: "P2002" });
    await expect(sendingDomainService.create(externalInput)).rejects.toMatchObject({
      statusCode: 409
    });
  });
});

describe("sendingDomainService.update / delete", () => {
  it("updates the spf note on an owned domain", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue({ id: "d1" } as never);
    prismaMock.sendingDomain.update.mockResolvedValue({ id: "d1" } as never);
    await sendingDomainService.update("d1", "user_1", { spfNote: "updated" });
    expect(prismaMock.sendingDomain.update.mock.calls[0][0].data).toEqual({
      spfNote: "updated"
    });
  });

  it("throws 404 deleting a domain the user does not own", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue(null);
    await expect(sendingDomainService.delete("d1", "user_1")).rejects.toThrow(
      HttpError
    );
  });

  it("deletes an owned domain", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue({ id: "d1" } as never);
    prismaMock.sendingDomain.delete.mockResolvedValue({ id: "d1" } as never);
    await sendingDomainService.delete("d1", "user_1");
    expect(prismaMock.sendingDomain.delete).toHaveBeenCalledWith({
      where: { id: "d1" }
    });
  });
});

beforeEach(() => {
  // Default: no existing rows so create paths are clean unless a test overrides.
  prismaMock.sendingDomain.findFirst.mockResolvedValue(null);
});
