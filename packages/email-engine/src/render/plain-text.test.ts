import { describe, expect, it } from "vitest";
import { plainTextFromHtml } from "./plain-text.js";
describe("plain quoted HTML content", () => {
  it("keeps paragraphs, entities, links and image labels without active markup", () => {
    const text = plainTextFromHtml(
      '<html><head><title>Hidden title</title><style>hidden css</style></head><body><p>Hello &amp; goodbye<br>Second line</p><div>Contact <a href="https://example.com">our team</a></div><img alt="Chart"><script>secret script</script><iframe>remote</iframe><p hidden>Hidden text</p></body></html>'
    );
    expect(text).toContain("Hello & goodbye\nSecond line");
    expect(text).toContain("our team <https://example.com>");
    expect(text).toContain("Chart");
    expect(text).not.toMatch(/secret|Hidden|hidden css|remote|<script>/);
  });
  it("does not duplicate a visible link or include an active URL scheme", () => {
    expect(
      plainTextFromHtml(
        '<a href="https://example.com">https://example.com</a><a href="javascript:bad()">Safe words</a>'
      )
    ).toBe("https://example.comSafe words");
  });
  it("handles empty mail and table text", () => {
    expect(plainTextFromHtml("")).toBe("");
    expect(
      plainTextFromHtml("<table><tr><td>One</td><td>Two</td></tr></table>")
    ).toContain("One\tTwo");
  });
});
