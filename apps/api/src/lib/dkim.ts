import { generateKeyPairSync } from "node:crypto";

// A fixed selector keeps the DNS host predictable
// ({selector}._domainkey.{domain}). The record is domain-scoped, so one shared
// selector across managed domains is fine and matches how hosted ESPs work.
export const MANAGED_DKIM_SELECTOR = "qqueue";

export interface GeneratedDkim {
  selector: string;
  /** SPKI PEM — published (as the `p=` body) in the DKIM DNS record. */
  publicKey: string;
  /** PKCS#8 PEM — stored encrypted; the worker signs outbound mail with it. */
  privateKey: string;
}

/**
 * Generate an RSA-2048 DKIM keypair for managed-mode signing. RSA-2048 is the
 * interoperable default for DKIM (4096-bit keys can exceed a single DNS TXT
 * string and aren't universally supported).
 */
export function generateManagedDkim(): GeneratedDkim {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  return { selector: MANAGED_DKIM_SELECTOR, publicKey, privateKey };
}
