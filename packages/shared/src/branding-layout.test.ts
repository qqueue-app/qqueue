import { describe, expect, it } from "vitest";
import {
  BRANDING_STARTERS,
  brandingLayoutError,
  createBrandingLayout,
  renderBrandingLayout
} from "./branding-layout.js";

const identity = {
  brandName: 'Acme & "Co"',
  logoUrl: "https://example.com/logo.png",
  accentColor: "#123456",
  footerNote: "First line\nSecond line"
};

describe("branding layouts", () => {
  it.each(BRANDING_STARTERS)(
    "keeps saved identity in the $name starter",
    (starter) => {
      const source = createBrandingLayout(identity, starter.id);
      expect(brandingLayoutError(source)).toBeNull();
      const html = renderBrandingLayout(source, "<p>Message</p>", identity);
      expect(html).toContain('<img src="https://example.com/logo.png"');
      expect(html).toContain("Acme &amp; &quot;Co&quot;");
      expect(html).toContain("#123456");
      expect(html).toContain("First line<br />Second line");
      expect(html).toContain("<p>Message</p>");
      expect(html).not.toContain("{{");
    }
  );
  it("keeps the email body verbatim and escapes identity text", () => {
    const content = '<p>{{firstName}} $& <img src="cid:attachment" /></p>';
    expect(
      renderBrandingLayout("{{brand_name}} {{ content }}", content, {
        brandName: "<script>"
      })
    ).toBe("&lt;script&gt; " + content);
  });
  it("handles unset fields without adding a vendor identity", () => {
    const html = renderBrandingLayout(createBrandingLayout({}), "Body", {});
    expect(html).toContain("Body");
    expect(html).not.toContain("&copy;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("QQueue");
    expect(html).toContain("#2E7D63");
    expect(
      renderBrandingLayout("{{brand_name}}{{logo_url}}{{footer_note}}", "", {})
    ).toBe("");
    expect(
      renderBrandingLayout("{{accent_color}}", "", { accentColor: "red;bad" })
    ).toBe("#2E7D63");
  });
  it.each(["", "<p>No content</p>", "{{content}} {{ content }}"])(
    "rejects missing or duplicated content markers: %s",
    (html) => {
      expect(brandingLayoutError(html)).toContain("exactly once");
    }
  );
  it("bounds stored layout size", () => {
    expect(brandingLayoutError("x".repeat(100_000) + "{{content}}")).toContain(
      "100,000"
    );
  });
});
