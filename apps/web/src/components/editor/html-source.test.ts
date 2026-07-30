import { describe, expect, it } from "vitest";
import {
  isFullHtmlDocument,
  richTextCanRepresent,
  unsupportedInRichText
} from "./html-source.js";

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

    expect(unsupportedInRichText(html).tags).toEqual([
      "html",
      "head",
      "style",
      "body"
    ]);
  });

  it("returns nothing for markup the editor can represent", () => {
    expect(
      unsupportedInRichText("<p>Hi <strong>there</strong></p><table></table>")
    ).toEqual({ tags: [], attributes: [] });
  });

  // A <div> isn't deleted, it's rewritten to a <p> — and the inline styles and
  // classes that made a hand-built email layout work go with it. Same loss to
  // whoever wrote the markup, so it counts.
  it("counts markup that is rewritten rather than removed", () => {
    expect(
      unsupportedInRichText('<div class="wrap"><font size="2">Hi</font></div>')
        .tags
    ).toEqual(["div", "font"]);
  });

  it("names each tag once", () => {
    expect(unsupportedInRichText("<div>a</div><div>b</div>").tags).toEqual([
      "div"
    ]);
  });

  it("ignores tag names appearing as text", () => {
    expect(unsupportedInRichText("<p>Wrap it in a &lt;div&gt;</p>")).toEqual({
      tags: [],
      attributes: []
    });
  });

  // The classic email layout table is built from tags the schema has — every
  // attribute that makes it a layout is what gets stripped.
  it("names attributes stripped from tags it otherwise keeps", () => {
    const html =
      '<table border="0" cellpadding="0" width="600"><tbody><tr>' +
      '<td align="center"><img src="a.png" width="120"></td></tr></tbody></table>';

    expect(unsupportedInRichText(html).attributes).toEqual([
      "border",
      "cellpadding",
      "width",
      "align"
    ]);
  });

  it("keeps the attributes the schema carries through", () => {
    const html =
      '<p style="text-align: right"><a href="https://example.com" ' +
      'target="_blank" rel="noopener" data-qq-button="true">Go</a>' +
      '<img src="a.png" alt="A" title="A"></p><table><tr><td colspan="2">x</td></tr></table>';

    expect(unsupportedInRichText(html).attributes).toEqual([]);
  });

  // Attributes on a doomed tag aren't worth listing separately.
  it("does not list attributes of a tag it already names", () => {
    expect(unsupportedInRichText('<div class="wrap">Hi</div>')).toEqual({
      tags: ["div"],
      attributes: []
    });
  });
});

// This is what decides whether a saved body opens in rich text or the source
// view. Getting it wrong in the permissive direction is destructive: the editor
// rewrites the document the moment it mounts over it.
describe("richTextCanRepresent", () => {
  it.each([
    "<p>Hi <em>there</em></p>",
    "<h1>Title</h1><ul><li>One</li></ul>",
    '<a href="https://example.com" data-qq-button="true"><span>Go</span></a>',
    "<table><tbody><tr><td>A</td></tr></tbody></table>",
    ""
  ])("keeps %s in rich text", (html) => {
    expect(richTextCanRepresent(html)).toBe(true);
  });

  it.each([
    '<div style="padding:24px"><p>Hi</p></div>',
    "<style>.x{}</style><p>Hi</p>",
    "<!doctype html><html><body><p>Hi</p></body></html>",
    '<body style="margin:0">Hi</body>',
    '<table border="0" cellpadding="0" width="600"><tr><td>Hi</td></tr></table>',
    '<p class="lead">Hi</p>'
  ])("sends %s to the source view", (html) => {
    expect(richTextCanRepresent(html)).toBe(false);
  });
});
