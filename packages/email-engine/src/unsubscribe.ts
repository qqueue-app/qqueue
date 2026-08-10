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
  return listUnsubscribeHeadersForUrl(
    buildUnsubscribeUrl(baseUrl, organizationId, email, secret)
  );
}

/**
 * The same headers, for a caller that already holds the URL. A send that shows a
 * visible footer needs the URL twice — in the headers and in the body — and
 * building it once means the two can never point at different addresses.
 */
export function listUnsubscribeHeadersForUrl(
  url: string
): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The unsubscribe endpoint's path, taken from an already-built URL so a custom
 * `APP_URL` (or a future path change) stays in one place. Falls back to the
 * canonical path when the URL is unparseable.
 */
function unsubscribePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/api/v1/unsubscribe";
  }
}

/** True when `content` already offers this unsubscribe endpoint. */
function alreadyLinked(content: string, url: string): boolean {
  return content.includes(unsubscribePath(url));
}

// Inline styles only, and a font stack matching the MJML layer's: Gmail and
// Outlook.com strip <style> blocks, and the footer has to look like it belongs
// to the message it is appended to rather than to the client's defaults.
const FOOTER_FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const BODY_CLOSE = /<\/body\s*>/i;

/**
 * Append a visible unsubscribe footer to bulk mail.
 *
 * Separate from the MJML layer on purpose: campaign fan-out never calls
 * `wrapHtmlInMjml` (a `Template.html` is already compiled when it is saved), so
 * the footer cannot ride along with `EmailBranding.unsubscribeUrl`. A string
 * append at send time is the one place that reaches every bulk path at once.
 *
 * Returns the HTML unchanged when it is empty, or when it already links to the
 * unsubscribe endpoint — which is what makes the `{{unsubscribe_url}}` merge tag
 * an override rather than a way to get two links.
 */
export interface UnsubscribeFooterOptions {
  /**
   * Small print above the link — in practice the organization's postal address,
   * which anti-spam law expects on bulk mail. Plain text: it is escaped, and
   * newlines become line breaks.
   */
  note?: string | null;
}

export function appendUnsubscribeFooter(
  html: string | null | undefined,
  url: string,
  options: UnsubscribeFooterOptions = {}
): string | undefined {
  if (!html) {
    return html ?? undefined;
  }

  if (alreadyLinked(html, url)) {
    return html;
  }

  const note = options.note?.trim();
  const noteBlock = note
    ? `<div style="margin:0 0 8px;">${escapeHtml(note).replace(/\r?\n/g, "<br />")}</div>`
    : "";

  const footer =
    `<div style="margin:0;padding:16px 0 24px;text-align:center;` +
    `font-family:${FOOTER_FONT};font-size:12px;line-height:1.5;color:#9aa5b1;">` +
    noteBlock +
    `<a href="${escapeHtml(url)}" style="color:#9aa5b1;text-decoration:underline;">Unsubscribe</a>` +
    `</div>`;

  // A complete document (a pasted Brevo/Mailchimp export, or MJML output) must
  // take the footer *inside* its body; appending past </body> or </html> leaves
  // it in territory clients are free to drop. A function replacement, not a
  // string one, so no `$&` in the footer can be reinterpreted.
  if (BODY_CLOSE.test(html)) {
    return html.replace(BODY_CLOSE, (close) => `${footer}${close}`);
  }

  return `${html}${footer}`;
}

/**
 * The plaintext half of the same footer.
 *
 * Deliberately returns `undefined` for an empty body rather than inventing one:
 * adding a text part to an HTML-only message would turn it into
 * multipart/alternative, which is a different message than the one the caller
 * built. A multipart message whose plaintext half has no opt-out is exactly what
 * spam filters penalise, so this exists to keep the two halves honest.
 */
export function appendUnsubscribeFooterText(
  text: string | null | undefined,
  url: string,
  options: UnsubscribeFooterOptions = {}
): string | undefined {
  if (!text) {
    return text ?? undefined;
  }

  if (alreadyLinked(text, url)) {
    return text;
  }

  const note = options.note?.trim();
  const notePart = note ? `${note}\n\n` : "";
  return `${text.replace(/\s+$/, "")}\n\n--\n${notePart}Unsubscribe: ${url}\n`;
}
