import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret } from "./crypto.js";

// Mirror the worker's key derivation: sha256 of the test ENCRYPTION_KEY
// (injected via vitest.config.ts), aes-256-gcm, with the blob encoded as
// `iv.tag.encrypted` base64url joined by ".".
const KEY = createHash("sha256")
  .update("test-encryption-key-thirty-two-byte")
  .digest();

function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

describe("decryptSecret", () => {
  it("decrypts a value produced with the same key scheme", () => {
    const blob = encryptSecret("super-secret-password");
    expect(decryptSecret(blob)).toBe("super-secret-password");
  });

  it("throws on a value missing the iv/tag/encrypted parts", () => {
    expect(() => decryptSecret("only-one-part")).toThrow(
      "Invalid encrypted secret format"
    );
  });

  it("throws when one of the three segments is empty", () => {
    expect(() => decryptSecret("abc..def")).toThrow(
      "Invalid encrypted secret format"
    );
  });

  it("throws when the auth tag does not match (tampered ciphertext)", () => {
    const [iv, tag] = encryptSecret("hello").split(".");
    const tampered = [iv, tag, "ZGVhZGJlZWY"].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
