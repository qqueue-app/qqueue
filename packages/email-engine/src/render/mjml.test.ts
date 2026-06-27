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
  it("wraps body HTML in an email-safe card with no default branding", () => {
    const doc = wrapHtmlInMjml("<p>Body</p>");
    expect(doc).toContain("<mjml>");
    // Author HTML survives verbatim inside the body card.
    expect(doc).toContain(
      `<mj-raw><div class="qq-body"><p>Body</p></div></mj-raw>`
    );
    // No vendor name is injected when no branding is supplied.
    expect(doc).not.toContain("QQueue");
    // With no header/footer, only the body card section remains.
    expect(doc).not.toContain("&copy;");
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
});
