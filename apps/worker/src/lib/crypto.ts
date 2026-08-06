import {
  SECRET_DECRYPTION_MESSAGE,
  SecretDecryptionError,
  createSecretCipher
} from "@qqueue/crypto";
import { env } from "../config/env.js";

// Thin binding of the shared crypto package to this app's keyring (Phase 5
// replaced the api/worker duplicated implementations — the envelope format
// lives in packages/crypto now). The worker only ever decrypts.
const cipher = createSecretCipher(env.ENCRYPTION_KEYS);

export const decryptSecret = cipher.decryptSecret;
export { SECRET_DECRYPTION_MESSAGE, SecretDecryptionError };
