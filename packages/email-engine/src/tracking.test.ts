import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildClickUrl,
  buildOpenPixelUrl,
  injectTracking,
  signTrackingToken,
  verifyTrackingToken,
  type ClickTokenPayload,
  type OpenTokenPayload
} from "./tracking.js";

const SECRET = "test-tracking-secret";

// Mirrors the sign() scheme in tracking.ts so we can craft a token whose
// signature is valid but whose body is not JSON.
function craftToken(body: string, secret: string): string {
  const encoded = Buffer.from(body).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

describe("signTrackingToken / verifyTrackingToken", () => {
  it("round-trips an open token payload", () => {
    const token = signTrackingToken({ j: "job_1" }, SECRET);
    const payload = verifyTrackingToken<OpenTokenPayload>(token, SECRET);
    expect(payload).toEqual({ j: "job_1" });
  });

  it("round-trips a click token payload", () => {
    const token = signTrackingToken(
      { j: "job_1", u: "https://example.com" },
      SECRET
    );
    const payload = verifyTrackingToken<ClickTokenPayload>(token, SECRET);
    expect(payload).toEqual({ j: "job_1", u: "https://example.com" });
  });

  it("returns null for a tampered signature", () => {
    const token = signTrackingToken({ j: "job_1" }, SECRET);
    const [body] = token.split(".");
    expect(verifyTrackingToken(`${body}.deadbeef`, SECRET)).toBeNull();
  });

  it("returns null when the body is missing", () => {
    expect(verifyTrackingToken(".onlysignature", SECRET)).toBeNull();
  });

  it("returns null when the signature is missing", () => {
    expect(verifyTrackingToken("onlybody", SECRET)).toBeNull();
  });

  it("returns null for an empty token", () => {
    expect(verifyTrackingToken("", SECRET)).toBeNull();
  });

  it("returns null for a validly signed but unparseable payload", () => {
    const token = craftToken("not json", SECRET);
    expect(verifyTrackingToken(token, SECRET)).toBeNull();
  });

  it("returns null when verified with the wrong secret", () => {
    const token = signTrackingToken({ j: "job_1" }, SECRET);
    expect(verifyTrackingToken(token, "other-secret")).toBeNull();
  });
});

describe("buildOpenPixelUrl", () => {
  it("builds a verifiable open pixel URL", () => {
    const url = buildOpenPixelUrl("https://t.example.com", "job_9", SECRET);
    expect(url.startsWith("https://t.example.com/api/v1/track/open/")).toBe(
      true
    );
    const token = url.split("/track/open/")[1];
    expect(verifyTrackingToken<OpenTokenPayload>(token, SECRET)).toEqual({
      j: "job_9"
    });
  });

  it("trims trailing slashes from the base URL", () => {
    const url = buildOpenPixelUrl("https://t.example.com///", "job_9", SECRET);
    expect(url.startsWith("https://t.example.com/api/v1/track/open/")).toBe(
      true
    );
  });
});

describe("buildClickUrl", () => {
  it("builds a verifiable click URL carrying the destination", () => {
    const url = buildClickUrl(
      "https://t.example.com/",
      "job_9",
      "https://dest.example.com/page",
      SECRET
    );
    expect(url.startsWith("https://t.example.com/api/v1/track/click/")).toBe(
      true
    );
    const token = url.split("/track/click/")[1];
    expect(verifyTrackingToken<ClickTokenPayload>(token, SECRET)).toEqual({
      j: "job_9",
      u: "https://dest.example.com/page"
    });
  });
});

describe("injectTracking", () => {
  const ctx = {
    emailJobId: "job_1",
    baseUrl: "https://t.example.com",
    secret: SECRET
  };

  it("returns undefined for null html", () => {
    expect(injectTracking(null, ctx)).toBeUndefined();
  });

  it("returns undefined for undefined html", () => {
    expect(injectTracking(undefined, ctx)).toBeUndefined();
  });

  it("returns the empty string unchanged for empty html", () => {
    // "" is falsy, so the guard returns `html ?? undefined`, which is "".
    expect(injectTracking("", ctx)).toBe("");
  });

  it("rewrites absolute http(s) links to click URLs", () => {
    const result = injectTracking(
      '<body><a href="https://example.com/x">link</a></body>',
      ctx
    );
    expect(result).toContain("/api/v1/track/click/");
    expect(result).not.toContain('href="https://example.com/x"');
  });

  it("leaves relative and mailto links alone", () => {
    const result = injectTracking(
      '<body><a href="/relative">r</a><a href="mailto:a@b.com">m</a></body>',
      ctx
    );
    expect(result).toContain('href="/relative"');
    expect(result).toContain('href="mailto:a@b.com"');
  });

  it("appends the open pixel into <body>", () => {
    const result = injectTracking("<body><p>Hi</p></body>", ctx) as string;
    expect(result).toContain("/api/v1/track/open/");
    expect(result).toContain('width="1"');
    // Pixel lives inside the body element.
    expect(result).toMatch(/<img[^>]*track\/open[^>]*>\s*<\/body>/);
  });

  it("wraps a body-less fragment and still appends the open pixel", () => {
    // cheerio.load always synthesises a <body>, so a fragment is wrapped and
    // the pixel lands inside that generated body element.
    const result = injectTracking("<p>No body here</p>", ctx) as string;
    expect(result).toContain("/api/v1/track/open/");
    expect(result).toMatch(/<img[^>]*track\/open[^>]*>\s*<\/body>/);
  });
});
