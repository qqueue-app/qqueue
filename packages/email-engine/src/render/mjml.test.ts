import { describe, expect, it } from "vitest";
import { injectTracking } from "../tracking.js";
import {
  isFullHtmlDocument,
  renderHtmlAsEmailSafe,
  renderMjml,
  wrapHtmlInMjml
} from "./mjml.js";

const validDocument = `
  <mjml>
    <mj-body>
      <mj-section>
        <mj-column>
          <mj-text>Hello <a href="https://example.com">link</a></mj-text>
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>
`;

describe("renderMjml", () => {
  it("compiles MJML into email-safe (table-based, inline-CSS) HTML", async () => {
    const result = await renderMjml(validDocument);

    expect(result.usedFallback).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.html).toContain("<table");
    expect(result.html).toContain("style=");
    expect(result.html).toContain("https://example.com");
  });

  it("falls back instead of throwing when compilation fails in strict mode", async () => {
    const result = await renderMjml("<mjml><mj-not-a-real-tag /></mjml>", {
      validationLevel: "strict",
      fallbackHtml: "<p>fallback</p>"
    });

    expect(result.usedFallback).toBe(true);
    expect(result.html).toBe("<p>fallback</p>");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("defaults the fallback to the original source", async () => {
    const source = "<mjml><mj-bogus></mj-bogus></mjml>";
    const result = await renderMjml(source, { validationLevel: "strict" });

    expect(result.usedFallback).toBe(true);
    expect(result.html).toBe(source);
  });

  it("remains compatible with tracking injection (render then inject)", async () => {
    const { html } = await renderMjml(validDocument);

    const tracked = injectTracking(html, {
      emailJobId: "ej_1",
      baseUrl: "https://app.example.com",
      secret: "s3cret"
    });

    // Tracking pixel appended and the original link rewritten to the click URL.
    expect(tracked).toContain("/api/v1/track/open/");
    expect(tracked).toContain("/api/v1/track/click/");
    // The email-safe table structure survives tracking injection.
    expect(tracked).toContain("<table");
  });
});

describe("wrapHtmlInMjml / renderHtmlAsEmailSafe", () => {
  it("wraps body HTML in an email-safe document with no default branding", () => {
    const doc = wrapHtmlInMjml("<p>Body</p>");
    expect(doc).toContain("<mjml>");
    // Author HTML survives verbatim inside the body.
    expect(doc).toContain(
      `<mj-text padding="0"><div class="qq-body"><p>Body</p></div></mj-text>`
    );
    // No vendor name is injected when no branding is supplied.
    expect(doc).not.toContain("QQueue");
    // With no header/footer, only the body section remains.
    expect(doc).not.toContain("&copy;");
  });

  // The body used to render as a rounded white card floating on a tinted page.
  // That was chrome the sender never authored, so it reads as the product
  // stamping its own styling onto their mail.
  it("adds no card panel or page tint of its own", () => {
    const doc = wrapHtmlInMjml("<p>Body</p>");
    expect(doc).not.toContain("border-radius");
    expect(doc).not.toContain("#eef2f1");
    expect(doc).toContain("<mj-body>");
  });

  it("renders a brand header and copyright footer only when opted in", () => {
    const doc = wrapHtmlInMjml("<p>Hi</p>", { brandName: "Acme" });
    expect(doc).toContain("Acme");
    expect(doc).toContain("&copy; Acme");
  });

  it("applies custom branding (brand name + accent + unsubscribe)", () => {
    const doc = wrapHtmlInMjml("<p>Hi</p>", {
      brandName: "Acme",
      accentColor: "#ff0000",
      unsubscribeUrl: "https://app.example.com/unsub?token=abc"
    });
    expect(doc).toContain("Acme");
    expect(doc).toContain("#ff0000");
    expect(doc).toContain("https://app.example.com/unsub?token=abc");
    expect(doc).toContain("Unsubscribe");
  });

  it("renders wrapped body HTML to email-safe HTML", async () => {
    const result = await renderHtmlAsEmailSafe("<p>Body</p>");

    expect(result.usedFallback).toBe(false);
    expect(result.html).toContain("<table");
    expect(result.html).toContain("<p>Body</p>");
  });

  // Regression: the body used to be emitted via mj-raw, which places it as a
  // direct child of <tbody>. Parsers foster-parent that out of the table and
  // into the column wrapper (font-size:0px), so the body arrived invisible —
  // present in the source, blank on screen. Asserting the body is merely
  // *present* does not catch this; assert where it lands.
  it("places the body inside a table cell, never directly in <tbody>", async () => {
    const result = await renderHtmlAsEmailSafe("<p>Body</p>");

    expect(result.html).not.toMatch(/<tbody>\s*<div class="qq-body">/);
    // The cell wrapper carries a real font-size, so the body can't inherit 0px.
    const body = result.html.slice(
      result.html.indexOf("</style>"),
      result.html.indexOf('<div class="qq-body">')
    );
    expect(body).toMatch(/<td[^>]*>/);
    expect(body).toMatch(/font-size:16px/);
  });
});

describe("isFullHtmlDocument", () => {
  it.each([
    ["<!doctype html><html><body><p>Hi</p></body></html>"],
    ["<!DOCTYPE HTML>\n<html>\n<body>Hi</body>\n</html>"],
    ["<html><head></head><body>Hi</body></html>"],
    ['<body style="margin:0">Hi</body>'],
    ["<html>\n  <body>Hi</body>\n</html>"]
  ])("treats %s as a complete document", (html) => {
    expect(isFullHtmlDocument(html)).toBe(true);
  });

  it.each([
    ["<p>Hi</p>"],
    [""],
    ["<div><table><tr><td>Hi</td></tr></table></div>"],
    // Escaped markup in a code sample is content, not a document declaration.
    ["<p>Write &lt;html&gt; to start a document</p>"],
    // Tag-boundary check: a word starting with "body" is not the body element.
    ["<p>Track your <em>bodyweight</em> here</p>"]
  ])("treats %s as a fragment", (html) => {
    expect(isFullHtmlDocument(html)).toBe(false);
  });
});

// Pasting an already-built email (a Brevo/Mailchimp export) must not be nested
// inside MJML's own <html><body> — that produces markup no client renders. The
// document is passed through byte-for-byte instead.
describe("renderHtmlAsEmailSafe with a complete document", () => {
  it("passes a full HTML document through untouched", async () => {
    const source =
      '<!doctype html><html><head><style>.x{color:red}</style></head>' +
      '<body><table><tr><td>Pasted</td></tr></table></body></html>';

    const result = await renderHtmlAsEmailSafe(source);

    expect(result.html).toBe(source);
    expect(result.errors).toEqual([]);
    expect(result.usedFallback).toBe(false);
  });

  it("does not add MJML scaffolding around a full document", async () => {
    const result = await renderHtmlAsEmailSafe(
      "<html><body><p>Pasted</p></body></html>"
    );

    expect(result.html).not.toContain("qq-body");
    // A second <html> element is the exact corruption this guards against.
    expect(result.html.match(/<html/gi)).toHaveLength(1);
  });

  it("still wraps a body fragment", async () => {
    const result = await renderHtmlAsEmailSafe("<p>Fragment</p>");

    expect(result.html).toContain("qq-body");
    expect(result.html).toContain("<table");
  });
});
