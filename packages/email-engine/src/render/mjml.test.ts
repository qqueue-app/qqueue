import { describe, expect, it } from "vitest";
import { injectTracking } from "../tracking.js";
import { renderHtmlAsEmailSafe, renderMjml, wrapHtmlInMjml } from "./mjml.js";

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
  it("wraps body HTML in a minimal MJML document", () => {
    const doc = wrapHtmlInMjml("<p>Body</p>");
    expect(doc).toContain("<mjml>");
    expect(doc).toContain("<mj-raw><p>Body</p></mj-raw>");
  });

  it("renders wrapped body HTML to email-safe HTML", async () => {
    const result = await renderHtmlAsEmailSafe("<p>Body</p>");

    expect(result.usedFallback).toBe(false);
    expect(result.html).toContain("<table");
    expect(result.html).toContain("<p>Body</p>");
  });
});
