import { createHmac, timingSafeEqual } from "node:crypto";

// One-click unsubscribe (RFC 2369 / RFC 8058). The List-Unsubscribe URL carries
// a self-describing, HMAC-signed token so the public unsubscribe endpoint can
// trust an incoming request without a database lookup or any auth — mirroring
// the open/click tracking tokens in `tracking.ts`.

export interface UnsubscribeTokenPayload {
  /** Organization id. */
  o: string;
  /** Recipient email being unsubscribed. */
  e: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/** Sign a payload into a URL-safe `<body>.<signature>` token. */
export function signUnsubscribeToken(
  payload: UnsubscribeTokenPayload,
  secret: string
): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/** Verify a token's signature and return its payload, or null if invalid. */
export function verifyUnsubscribeToken(
  token: string,
  secret: string
): UnsubscribeTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature || !safeEqual(signature, sign(body, secret))) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as UnsubscribeTokenPayload;
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Absolute one-click unsubscribe URL for an org/recipient pair. */
export function buildUnsubscribeUrl(
  baseUrl: string,
  organizationId: string,
  email: string,
  secret: string
): string {
  const token = signUnsubscribeToken({ o: organizationId, e: email }, secret);
  return `${trimTrailingSlash(baseUrl)}/api/v1/unsubscribe?token=${token}`;
}

/**
 * The `List-Unsubscribe` and `List-Unsubscribe-Post` headers for RFC 8058
 * one-click unsubscribe. URL-based only: a mailto would need a monitored inbox
 * that self-hosters may not have.
 */
export function buildListUnsubscribeHeaders(
  baseUrl: string,
  organizationId: string,
  email: string,
  secret: string
): Record<string, string> {
  const url = buildUnsubscribeUrl(baseUrl, organizationId, email, secret);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };
}
