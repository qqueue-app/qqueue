import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { decryptSecret } from "../../lib/crypto.js";
import { dkimVerificationQueue } from "../../queues/dkim-verification.queue.js";
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
    // Non-managed rows carry an explicit dnsRecords: null.
    expect(result).toEqual({ id: "d1", dnsRecords: null });
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

  it("generates and encrypts a keypair for managed mode and starts PENDING", async () => {
    prismaMock.sendingDomain.create.mockImplementation(
      (args) => ({ id: "d1", ...args.data }) as never
    );
    const result = await sendingDomainService.create({
      ...externalInput,
      dkimMode: "MANAGED"
    });
    const data = prismaMock.sendingDomain.create.mock.calls[0][0].data;
    expect(data.dkimMode).toBe("MANAGED");
    expect(data.dkimStatus).toBe("PENDING");
    expect(data.dkimSelector).toBe("qqueue");
    expect(data.dkimPublicKey).toContain("BEGIN PUBLIC KEY");
    // Private key is stored encrypted but round-trips back to a PEM.
    expect(decryptSecret(data.dkimPrivateKeyEncrypted as string)).toContain(
      "BEGIN PRIVATE KEY"
    );
    // Managed domains carry copy-paste DNS records (external ones do not).
    expect(result.dnsRecords?.dkim.host).toBe("qqueue._domainkey.acme.com");
    expect(result.dnsRecords?.dkim.value).toContain("v=DKIM1");
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

describe("sendingDomainService.verify", () => {
  it("enqueues a DNS recheck for a managed domain", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue({
      id: "d1",
      dkimMode: "MANAGED"
    } as never);
    const result = await sendingDomainService.verify("d1", "user_1");
    expect(result).toEqual({ status: "queued" });
    expect(dkimVerificationQueue.add).toHaveBeenCalledWith(
      "verify-dkim",
      { sendingDomainId: "d1" },
      expect.objectContaining({ attempts: 3 })
    );
  });

  it("rejects verify for an external-mode domain", async () => {
    prismaMock.sendingDomain.findFirst.mockResolvedValue({
      id: "d1",
      dkimMode: "EXTERNAL"
    } as never);
    await expect(sendingDomainService.verify("d1", "user_1")).rejects.toThrow(
      /managed-DKIM/
    );
  });
});

beforeEach(() => {
  // Default: no existing rows so create paths are clean unless a test overrides.
  prismaMock.sendingDomain.findFirst.mockResolvedValue(null);
});
