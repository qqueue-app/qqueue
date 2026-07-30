import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url.js";

describe("normalizeUrl", () => {
  // The whole point: a scheme is not something the user should have to type.
  it.each([
    ["example.com", "https://example.com"],
    ["www.example.com/pricing", "https://www.example.com/pricing"],
    ["example.com:8080/path", "https://example.com:8080/path"],
    ["  example.com  ", "https://example.com"]
  ])("fills in the scheme for %s", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it.each([
    "https://example.com",
    "http://example.com",
    "HTTPS://Example.com/Path",
    "mailto:hi@example.com",
    "tel:+15550100",
    "cid:logo.png"
  ])("leaves %s alone", (input) => {
    expect(normalizeUrl(input)).toBe(input);
  });

  it("treats a bare address as email", () => {
    expect(normalizeUrl("hi@example.com")).toBe("mailto:hi@example.com");
  });

  // Sending-time substitution supplies the real address, so prefixing here
  // would corrupt it.
  it("leaves a template variable untouched", () => {
    expect(normalizeUrl("{{ctaUrl}}")).toBe("{{ctaUrl}}");
  });

  it.each(["#section", "/pricing"])("leaves %s relative", (input) => {
    expect(normalizeUrl(input)).toBe(input);
  });

  it("gives a protocol-relative URL a scheme", () => {
    expect(normalizeUrl("//cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png"
    );
  });

  // A scheme with nothing after it is the stub a URL field starts with, not an
  // address — reporting it as unusable is what keeps the dialog open.
  it.each(["", "   ", "https://", "http://", "mailto:"])(
    "reports %s as unusable",
    (input) => {
      expect(normalizeUrl(input)).toBe("");
    }
  );
});
