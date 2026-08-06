import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SECRET_DECRYPTION_MESSAGE,
  SecretDecryptionError,
  createSecretCipher,
  hashPassword,
  verifyPassword,
} from "./crypto.js";

/** Build a pre-keyring (legacy, unversioned) ciphertext for a given key. */
function legacyEncrypt(plaintext: string, keySecret: string): string {
  const key = createHash("sha256").update(keySecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

describe("createSecretCipher", () => {
  const cipher = createSecretCipher(["key-a"]);

  it("round-trips and emits the versioned envelope", () => {
    const ciphertext = cipher.encryptSecret("hunter2");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(ciphertext.split(".")).toHaveLength(4);
    expect(cipher.decryptSecret(ciphertext)).toBe("hunter2");
  });

  it("still decrypts the legacy (unversioned) format", () => {
    const legacy = legacyEncrypt("old-secret", "key-a");
    expect(cipher.decryptSecret(legacy)).toBe("old-secret");
  });

  it("decrypts with a previous keyring entry after rotation", () => {
    const oldCipher = createSecretCipher(["key-old"]);
    const ciphertext = oldCipher.encryptSecret("survives-rotation");

    const rotated = createSecretCipher(["key-new", "key-old"]);
    expect(rotated.decryptSecret(ciphertext)).toBe("survives-rotation");
    // New writes use the new key: the old-only cipher can no longer read them.
    expect(() =>
      oldCipher.decryptSecret(rotated.encryptSecret("fresh"))
    ).toThrow(SecretDecryptionError);
  });

  it("throws SecretDecryptionError when no keyring entry matches", () => {
    const other = createSecretCipher(["some-other-key"]);
    expect(() => other.decryptSecret(cipher.encryptSecret("x"))).toThrow(
      SECRET_DECRYPTION_MESSAGE
    );
  });

  it("throws on malformed and tampered ciphertexts", () => {
    expect(() => cipher.decryptSecret("not-an-envelope")).toThrow(
      SecretDecryptionError
    );
    expect(() => cipher.decryptSecret("a.b")).toThrow(SecretDecryptionError);

    const ciphertext = cipher.encryptSecret("payload");
    const parts = ciphertext.split(".");
    parts[3] = Buffer.from("tampered-data").toString("base64url");
    expect(() => cipher.decryptSecret(parts.join("."))).toThrow(
      SecretDecryptionError
    );
  });

  it("requires at least one non-blank key", () => {
    expect(() => createSecretCipher([])).toThrow();
    expect(() => createSecretCipher(["  ", ""])).toThrow();
  });

  describe("needsRotation", () => {
    it("flags legacy-format ciphertexts", () => {
      expect(cipher.needsRotation(legacyEncrypt("s", "key-a"))).toBe(true);
    });

    it("flags ciphertexts written by a non-current key", () => {
      const oldCipher = createSecretCipher(["key-old"]);
      const rotated = createSecretCipher(["key-new", "key-old"]);
      expect(rotated.needsRotation(oldCipher.encryptSecret("s"))).toBe(true);
    });

    it("passes ciphertexts already on the current key and envelope", () => {
      expect(cipher.needsRotation(cipher.encryptSecret("s"))).toBe(false);
    });
  });
});

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash.startsWith("scrypt:")).toBe(true);
    await expect(verifyPassword("correct horse", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("rejects null and malformed hashes", async () => {
    await expect(verifyPassword("x", null)).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt:oops")).resolves.toBe(false);
  });
});
