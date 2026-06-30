import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";

const resolveTxt = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ promises: { resolveTxt } }));

import { dkimTxtValue } from "@qqueue/shared";
import {
  verifyAllManagedDomains,
  verifySendingDomain
} from "./dkim-verify.js";

// dkimRecordMatches compares only the p= body, so an arbitrary PEM-shaped string
// is enough — no real RSA key needed.
const PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\nMFwwDQYJABCDEF1234567890\n-----END PUBLIC KEY-----";

const managedDomain = {
  id: "d1",
  domain: "acme.com",
  dkimMode: "MANAGED",
  dkimSelector: "qqueue",
  dkimPublicKey: PUBLIC_KEY
};

beforeEach(() => {
  resolveTxt.mockReset();
});

describe("verifySendingDomain", () => {
  it("marks VERIFIED when the published record matches", async () => {
    prismaMock.sendingDomain.findUnique.mockResolvedValue(managedDomain as never);
    resolveTxt.mockResolvedValue([[dkimTxtValue(PUBLIC_KEY)]]);

    await verifySendingDomain("d1");

    expect(resolveTxt).toHaveBeenCalledWith("qqueue._domainkey.acme.com");
    const data = prismaMock.sendingDomain.update.mock.calls[0][0].data;
    expect(data.dkimStatus).toBe("VERIFIED");
    expect(data.verifiedAt).toBeInstanceOf(Date);
  });

  it("marks FAILED when the record is absent (DNS error)", async () => {
    prismaMock.sendingDomain.findUnique.mockResolvedValue(managedDomain as never);
    resolveTxt.mockRejectedValue(new Error("ENOTFOUND"));

    await verifySendingDomain("d1");

    const data = prismaMock.sendingDomain.update.mock.calls[0][0].data;
    expect(data.dkimStatus).toBe("FAILED");
    expect(data.verifiedAt).toBeUndefined();
  });

  it("marks FAILED when a different key is published", async () => {
    prismaMock.sendingDomain.findUnique.mockResolvedValue(managedDomain as never);
    resolveTxt.mockResolvedValue([["v=DKIM1; k=rsa; p=SOMEOTHERKEYVALUE"]]);

    await verifySendingDomain("d1");

    expect(prismaMock.sendingDomain.update.mock.calls[0][0].data.dkimStatus).toBe(
      "FAILED"
    );
  });

  it("skips external-mode domains without a DNS lookup", async () => {
    prismaMock.sendingDomain.findUnique.mockResolvedValue({
      ...managedDomain,
      dkimMode: "EXTERNAL"
    } as never);

    await verifySendingDomain("d1");

    expect(resolveTxt).not.toHaveBeenCalled();
    expect(prismaMock.sendingDomain.update).not.toHaveBeenCalled();
  });

  it("skips a deleted domain", async () => {
    prismaMock.sendingDomain.findUnique.mockResolvedValue(null);
    await verifySendingDomain("d1");
    expect(prismaMock.sendingDomain.update).not.toHaveBeenCalled();
  });
});

describe("verifyAllManagedDomains", () => {
  it("verifies each managed domain", async () => {
    prismaMock.sendingDomain.findMany.mockResolvedValue([
      { id: "d1" },
      { id: "d2" }
    ] as never);
    prismaMock.sendingDomain.findUnique.mockResolvedValue(managedDomain as never);
    resolveTxt.mockResolvedValue([[dkimTxtValue(PUBLIC_KEY)]]);

    await verifyAllManagedDomains();

    expect(prismaMock.sendingDomain.update).toHaveBeenCalledTimes(2);
  });
});
