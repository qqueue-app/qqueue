import { describe, expect, it } from "vitest";
import { applyEmailBranding } from "./branding.js";

describe("applyEmailBranding", () => {
  it("applies the configured design without the default MJML wrapper", () => {
    const html = applyEmailBranding("<p>Body</p>", {
      brandingEnabled: true,
      brandName: "Acme",
      layoutHtml: "<html><body><header>{{brand_name}}</header>{{content}}</body></html>",
    });

    expect(html).toBe(
      "<html><body><header>Acme</header><p>Body</p></body></html>"
    );
  });

  it("leaves unbranded, disabled, and complete authored documents alone", () => {
    expect(applyEmailBranding("<p>Body</p>", null)).toBe("<p>Body</p>");
    expect(
      applyEmailBranding("<p>Body</p>", {
        brandingEnabled: false,
        brandName: "Acme",
      })
    ).toBe("<p>Body</p>");
    expect(
      applyEmailBranding("<html><body>Body</body></html>", {
        brandingEnabled: true,
        brandName: "Acme",
      })
    ).toBe("<html><body>Body</body></html>");
  });
});
