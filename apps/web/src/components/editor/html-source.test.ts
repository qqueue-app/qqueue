import { describe, expect, it } from "vitest";
import { isFullHtmlDocument, unsupportedInRichText } from "./html-source.js";

// These mirror the email-engine implementation the server renders with. If the
// two disagree, the UI promises one thing ("sent as-is") and the pipeline does
// another — keep the cases here aligned with mjml.test.ts.
describe("isFullHtmlDocument", () => {
  it.each([
    "<!doctype html><html><body><p>Hi</p></body></html>",
    "<!DOCTYPE HTML>\n<html>\n<body>Hi</body>\n</html>",
    "<html><head></head><body>Hi</body></html>",
    '<body style="margin:0">Hi</body>'
  ])("treats %s as a complete document", (html) => {
    expect(isFullHtmlDocument(html)).toBe(true);
  });

  it.each([
    "<p>Hi</p>",
    "",
    "<div><table><tr><td>Hi</td></tr></table></div>",
    "<p>Write &lt;html&gt; to start a document</p>",
    "<p>Track your <em>bodyweight</em> here</p>"
  ])("treats %s as a fragment", (html) => {
    expect(isFullHtmlDocument(html)).toBe(false);
  });
});

describe("unsupportedInRichText", () => {
  it("names the tags the editor would delete", () => {
    const html =
      "<html><head><style>.x{}</style></head><body><p>Hi</p></body></html>";

    expect(unsupportedInRichText(html)).toEqual(["style", "head"]);
  });

  it("returns nothing for markup the editor can represent", () => {
    expect(
      unsupportedInRichText("<p>Hi <strong>there</strong></p><table></table>")
    ).toEqual([]);
  });
});
