import { createDecipheriv, createHash } from "node:crypto";
import { env } from "../config/env.js";

const encryptionKey = createHash("sha256").update(env.ENCRYPTION_KEY).digest();

export const SECRET_DECRYPTION_MESSAGE =
  "Stored SMTP credentials cannot be decrypted. Check ENCRYPTION_KEY; changing it invalidates existing SMTP credentials.";

export class SecretDecryptionError extends Error {
  constructor() {
    super(SECRET_DECRYPTION_MESSAGE);
    this.name = "SecretDecryptionError";
  }
}

export function decryptSecret(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");

  if (!ivText || !tagText || !encryptedText) {
    throw new SecretDecryptionError();
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(ivText, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  }
}
