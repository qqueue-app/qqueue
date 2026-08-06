import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * The one copy of QQueue's secret cryptography (Phase 5). The API and worker
 * used to carry byte-identical implementations whose ciphertext format was an
 * undeclared wire contract; both now wrap this package.
 *
 * ## Ciphertext envelope
 *
 * Secrets at rest (SMTP/IMAP credentials, webhook secrets) are AES-256-GCM.
 * Two formats exist on disk:
 *
 * - **v1 (current)**: `v1.<iv>.<tag>.<ciphertext>`, all parts base64url.
 * - **legacy**: `<iv>.<tag>.<ciphertext>` — everything written before the
 *   envelope was versioned. Still decrypts; `needsRotation` flags it.
 *
 * ## Key rotation
 *
 * Callers pass a *keyring*: an ordered list of key secrets where the first
 * entry encrypts and every entry may decrypt. Decryption tries each key in
 * order — GCM's auth tag tells us definitively whether a key matches, so the
 * envelope needs no key id and the keyring's order can change freely. To
 * rotate: prepend the new key, deploy, run the re-encryption script
 * (`pnpm rotate-secrets`), then drop the old key from the list.
 *
 * Each key secret is stretched to the AES key with sha256 — unchanged from
 * the pre-keyring format so existing ciphertexts keep decrypting.
 */

const scrypt = promisify(scryptCallback);

const ENVELOPE_VERSION = "v1";

export const SECRET_DECRYPTION_MESSAGE =
  "Stored credentials cannot be decrypted. Check ENCRYPTION_KEYS/ENCRYPTION_KEY — a key that encrypted existing secrets is missing from the keyring.";

export class SecretDecryptionError extends Error {
  constructor() {
    super(SECRET_DECRYPTION_MESSAGE);
    this.name = "SecretDecryptionError";
  }
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

interface ParsedEnvelope {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
  versioned: boolean;
}

function parseEnvelope(value: string): ParsedEnvelope {
  const parts = value.split(".");
  let versioned = false;
  if (parts.length === 4 && parts[0] === ENVELOPE_VERSION) {
    parts.shift();
    versioned = true;
  }
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new SecretDecryptionError();
  }
  const [iv, tag, ciphertext] = parts.map((part) =>
    Buffer.from(part, "base64url")
  );
  return { iv, tag, ciphertext, versioned };
}

function decryptWithKey(envelope: ParsedEnvelope, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, envelope.iv);
  decipher.setAuthTag(envelope.tag);
  return Buffer.concat([
    decipher.update(envelope.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export interface SecretCipher {
  /** Encrypt with the keyring's first (current) key, emitting a v1 envelope. */
  encryptSecret(value: string): string;
  /** Decrypt with whichever keyring entry matches (GCM tag decides). */
  decryptSecret(value: string): string;
  /**
   * True when a ciphertext should be rewritten by the rotation script: it is
   * in the legacy envelope, or it was encrypted by a non-current key.
   */
  needsRotation(value: string): boolean;
}

export function createSecretCipher(keySecrets: string[]): SecretCipher {
  const secrets = keySecrets.map((secret) => secret.trim()).filter(Boolean);
  if (secrets.length === 0) {
    throw new Error("createSecretCipher requires at least one key");
  }
  const keys = secrets.map(deriveKey);

  function decryptSecret(value: string): string {
    const envelope = parseEnvelope(value);
    for (const key of keys) {
      try {
        return decryptWithKey(envelope, key);
      } catch {
        // Auth tag mismatch — not this key; try the next.
      }
    }
    throw new SecretDecryptionError();
  }

  return {
    encryptSecret(value: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keys[0], iv);
      const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        ENVELOPE_VERSION,
        ...[iv, tag, ciphertext].map((part) => part.toString("base64url")),
      ].join(".");
    },

    decryptSecret,

    needsRotation(value: string): boolean {
      const envelope = parseEnvelope(value);
      if (!envelope.versioned) {
        return true;
      }
      try {
        decryptWithKey(envelope, keys[0]);
        return false;
      } catch {
        // Decryptable (or not) only by an older key — either way, rewrite it;
        // the rotation script surfaces truly undecryptable rows separately.
        return true;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt). One-way; unrelated to the keyring above. Stored
// as `scrypt:<salt>:<hexkey>` with Node's default cost parameters.

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  passwordHash: string | null
): Promise<boolean> {
  if (!passwordHash) {
    return false;
  }

  const [algorithm, salt, storedHash] = passwordHash.split(":");

  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const storedKey = Buffer.from(storedHash, "hex");
  const derivedKey = (await scrypt(password, salt, storedKey.length)) as Buffer;

  return (
    storedKey.length === derivedKey.length &&
    timingSafeEqual(storedKey, derivedKey)
  );
}
