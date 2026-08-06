import {
  SECRET_DECRYPTION_MESSAGE,
  SecretDecryptionError,
  createSecretCipher,
  hashPassword,
  verifyPassword
} from "@qqueue/crypto";
import { env } from "../config/env.js";

// Thin binding of the shared crypto package to this app's keyring (Phase 5
// replaced the api/worker duplicated implementations — the envelope format
// lives in packages/crypto now). Call sites keep the same imports as before.
const cipher = createSecretCipher(env.ENCRYPTION_KEYS);

export const encryptSecret = cipher.encryptSecret;
export const decryptSecret = cipher.decryptSecret;
export const needsRotation = cipher.needsRotation;
export {
  SECRET_DECRYPTION_MESSAGE,
  SecretDecryptionError,
  hashPassword,
  verifyPassword
};
