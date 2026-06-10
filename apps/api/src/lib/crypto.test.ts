import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  verifyPassword
} from "./crypto.js";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("super-secret");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("super-secret", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("super-secret");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("returns false for a null hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
  });

  it("returns false for a non-scrypt algorithm", async () => {
    expect(await verifyPassword("anything", "bcrypt:salt:hash")).toBe(false);
  });

  it("returns false when the hash is malformed (missing parts)", async () => {
    expect(await verifyPassword("anything", "scrypt::")).toBe(false);
  });

  it("returns false when the stored key length differs", async () => {
    // A scrypt-prefixed hash whose stored key has length 1 (one hex byte).
    expect(await verifyPassword("anything", "scrypt:abcd:00")).toBe(false);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret value", () => {
    const cipher = encryptSecret("my-password");
    expect(cipher.split(".")).toHaveLength(3);
    expect(decryptSecret(cipher)).toBe("my-password");
  });

  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("throws on an invalid encrypted format", () => {
    expect(() => decryptSecret("only-one-part")).toThrow(
      "Invalid encrypted secret format"
    );
  });
});
