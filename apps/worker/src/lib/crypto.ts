import { createDecipheriv, createHash } from "node:crypto";
import { env } from "../config/env.js";

const encryptionKey = createHash("sha256").update(env.ENCRYPTION_KEY).digest();

export function decryptSecret(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");

  if (!ivText || !tagText || !encryptedText) {
    throw new Error("Invalid encrypted secret format");
  }

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
}
