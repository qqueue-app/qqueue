import { describe, expect, it } from "vitest";
import { mailPreview } from "./mail-preview.js";
describe("mail previews", () => {
  it("prefers useful text and leaves message markup out of an excerpt", () => {
    expect(mailPreview("  A normal\nreply  ", "<p>Other</p>")).toBe(
      "A normal reply"
    );
    expect(
      mailPreview(
        null,
        "<style>body{color:red}</style><script>alert(1)</script><p>Hello &amp; welcome</p>"
      )
    ).toBe("Hello & welcome");
  });
  it("falls back from placeholder and CSS text to the actual HTML body", () => {
    expect(mailPreview("none", "<p>Your receipt</p>")).toBe("Your receipt");
    expect(
      mailPreview("body{margin:0;color:red}", "<p>Actual message</p>")
    ).toBe("Actual message");
    expect(mailPreview("undefined")).toBe("");
    expect(mailPreview("Here are the fields {name: Ada}")).toBe(
      "Here are the fields {name: Ada}"
    );
  });
  it("removes image scaffolding without removing ordinary links or quoted writing", () => {
    expect(
      mailPreview("Image [https://example.test/logo.png] Your invoice is ready")
    ).toBe("Your invoice is ready");
    expect(mailPreview("Read https://example.test/invoice > Thank you")).toBe(
      "Read https://example.test/invoice > Thank you"
    );
    expect(mailPreview("x".repeat(250))).toHaveLength(200);
  });
});
