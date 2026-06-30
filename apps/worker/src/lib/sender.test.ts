import { describe, expect, it, vi } from "vitest";

vi.mock("./crypto.js", () => ({
  decryptSecret: (value: string) => `decrypted:${value}`
}));

import { dkimSignOptionsFor, formatFrom } from "./sender.js";

const managedVerified = {
  domain: "acme.com",
  dkimMode: "MANAGED" as const,
  dkimStatus: "VERIFIED" as const,
  dkimSelector: "qqueue",
  dkimPrivateKeyEncrypted: "enc-key"
};

describe("worker dkimSignOptionsFor", () => {
  it("signs managed + verified domains with the decrypted key", () => {
    expect(dkimSignOptionsFor(managedVerified)).toEqual({
      domainName: "acme.com",
      keySelector: "qqueue",
      privateKey: "decrypted:enc-key"
    });
  });

  it("does not sign when the domain is absent (legacy job)", () => {
    expect(dkimSignOptionsFor(null)).toBeUndefined();
    expect(dkimSignOptionsFor(undefined)).toBeUndefined();
  });

  it("does not sign external or unverified domains", () => {
    expect(
      dkimSignOptionsFor({ ...managedVerified, dkimMode: "EXTERNAL" })
    ).toBeUndefined();
    expect(
      dkimSignOptionsFor({ ...managedVerified, dkimStatus: "FAILED" })
    ).toBeUndefined();
  });
});

describe("worker formatFrom", () => {
  it("formats with and without a display name", () => {
    expect(formatFrom({ fromEmail: "a@b.com", fromName: "Acme" })).toBe(
      "Acme <a@b.com>"
    );
    expect(formatFrom({ fromEmail: "a@b.com", fromName: null })).toBe("a@b.com");
  });
});
