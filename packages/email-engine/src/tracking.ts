import { createHmac, timingSafeEqual } from "node:crypto";
import * as cheerio from "cheerio";

// Open/click tracking works by signing a compact payload with an HMAC so the
// public tracking endpoints can trust an incoming token without a database
// lookup or any auth. Clicks also carry the (signed) destination URL, which is
// what stops the redirect endpoint from becoming an open redirect.

export interface OpenTokenPayload {
  /** EmailJob id. */
  j: string;
}

export interface ClickTokenPayload {
  /** EmailJob id. */
  j: string;
  /** Original destination URL. */
  u: string;
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
export function signTrackingToken(
  payload: OpenTokenPayload | ClickTokenPayload,
  secret: string
): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/** Verify a token's signature and return its payload, or null if invalid. */
export function verifyTrackingToken<T extends OpenTokenPayload>(
  token: string,
  secret: string
): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature || !safeEqual(signature, sign(body, secret))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Absolute URL for the 1x1 open-tracking pixel for an email job. */
export function buildOpenPixelUrl(
  baseUrl: string,
  emailJobId: string,
  secret: string
): string {
  const token = signTrackingToken({ j: emailJobId }, secret);
  return `${trimTrailingSlash(baseUrl)}/api/v1/track/open/${token}`;
}

/** Absolute click-tracking URL that redirects to `href` once recorded. */
export function buildClickUrl(
  baseUrl: string,
  emailJobId: string,
  href: string,
  secret: string
): string {
  const token = signTrackingToken({ j: emailJobId, u: href }, secret);
  return `${trimTrailingSlash(baseUrl)}/api/v1/track/click/${token}`;
}

export interface TrackingContext {
  emailJobId: string;
  baseUrl: string;
  secret: string;
}

/**
 * Rewrite every absolute `http(s)` link to a click-tracking URL and append a
 * 1x1 open-tracking pixel. Returns the original HTML unchanged if it is empty.
 */
export function injectTracking(
  html: string | null | undefined,
  ctx: TrackingContext
): string | undefined {
  if (!html) {
    return html ?? undefined;
  }

  const $ = cheerio.load(html);

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href && /^https?:\/\//i.test(href)) {
      $(element).attr(
        "href",
        buildClickUrl(ctx.baseUrl, ctx.emailJobId, href, ctx.secret)
      );
    }
  });

  const pixel = `<img src="${buildOpenPixelUrl(
    ctx.baseUrl,
    ctx.emailJobId,
    ctx.secret
  )}" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden" />`;

  const body = $("body");
  if (body.length) {
    body.append(pixel);
  } else {
    $.root().append(pixel);
  }

  return $.html();
}
