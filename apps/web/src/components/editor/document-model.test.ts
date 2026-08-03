import { describe, expect, it } from "vitest";
import {
  fromEditorHtml,
  holdsSameDocument,
  joinDocument,
  splitDocument,
  toEditorHtml
} from "./document-model.js";

/** What the editor would give back if the author changed nothing. */
function roundTrip(value: string): string {
  const { html, shell } = toEditorHtml(value);
  return fromEditorHtml(html, shell);
}

describe("splitDocument", () => {
  it("leaves a fragment alone", () => {
    expect(splitDocument("<p>Hi</p>")).toEqual({
      shell: null,
      body: "<p>Hi</p>"
    });
  });

  it("sets a complete document's scaffold aside", () => {
    const { shell, body } = splitDocument(
      '<!doctype html><html><head><style>.x{}</style></head><body class="b"><p>Hi</p></body></html>'
    );

    expect(body).toBe("<p>Hi</p>");
    expect(shell?.before).toBe(
      '<!doctype html><html><head><style>.x{}</style></head><body class="b">'
    );
    expect(shell?.after).toBe("</body></html>");
  });

  // The head is where the parts with no in-memory equivalent live, and it comes
  // back as the same bytes rather than as something rebuilt from them.
  it("puts a document back together character for character", () => {
    const source =
      '<!DOCTYPE html>\n<html xmlns:v="urn:schemas-microsoft-com:vml">\n' +
      "<head>\n<!--[if mso]><style>td{font-family:Arial}</style><![endif]-->\n" +
      '</head>\n<body bgcolor="#f4f4f5">\n<p>Hi</p>\n</body>\n</html>';

    const { shell, body } = splitDocument(source);

    expect(joinDocument(shell, body)).toBe(source);
  });
});

describe("toEditorHtml / fromEditorHtml", () => {
  it("returns ordinary content unchanged", () => {
    expect(roundTrip("<p>Hello <strong>there</strong></p>")).toBe(
      "<p>Hello <strong>there</strong></p>"
    );
  });

  // The regression this whole module exists for: a template written as raw HTML
  // was reopened into the editor, parsed into a schema that had no node for most
  // of it, and came back rewritten — which reads as the save having failed.
  it("returns hand-written email HTML unchanged", () => {
    const source =
      '<div style="max-width:600px;margin:0 auto">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0">' +
      '<tbody><tr><td align="center" style="padding:24px">Welcome aboard</td></tr></tbody>' +
      "</table></div>";

    expect(roundTrip(source)).toBe(source);
  });

  it("returns a complete document unchanged, head and all", () => {
    const source =
      "<!doctype html><html><head><style>.x{color:red}</style></head>" +
      '<body style="margin:0"><p>Hi</p></body></html>';

    expect(roundTrip(source)).toBe(source);
  });

  it("keeps markup the schema cannot hold, verbatim", () => {
    const source = "<style>.a{color:red}</style><p>Body</p>";

    expect(roundTrip(source)).toBe(source);
  });

  it("keeps an Outlook conditional comment", () => {
    const source = "<p>A</p><!--[if mso]><td>spacer</td><![endif]--><p>B</p>";

    expect(roundTrip(source)).toBe(source);
  });

  it("reports how much had to be frozen", () => {
    expect(toEditorHtml("<p>Hi</p>").frozen).toBe(0);
    expect(toEditorHtml("<style>.x{}</style><p>Hi</p>").frozen).toBe(1);
  });

  // Switching to rich text and back must not be a way to lose the document, so
  // a second trip has to be a no-op on the first one's output.
  it("is stable across repeated trips", () => {
    const source =
      '<div class="wrap"><style>.a{}</style><h1>Title</h1>' +
      '<table width="600"><tbody><tr><td>Cell</td></tr></tbody></table></div>';

    const once = roundTrip(source);

    expect(roundTrip(once)).toBe(once);
  });
});

// What tells the editor settling a document it was just given apart from an
// author editing it. Getting this wrong in either direction is a real bug:
// too strict marks a template dirty on open, too loose drops the first edit.
describe("holdsSameDocument", () => {
  it("ignores how the schema chose to write attributes back", () => {
    expect(
      holdsSameDocument(
        '<table width="100%" cellpadding="0"><tbody><tr><td style="padding: 24px;">A</td></tr></tbody></table>',
        '<table cellpadding="0" width="100%"><tbody><tr><td style="padding:24px">A</td></tr></tbody></table>'
      )
    ).toBe(true);
  });

  // The trailing node's paragraph, which arrives carrying the invented marker.
  it("ignores an empty paragraph appended after the document", () => {
    expect(
      holdsSameDocument(
        '<table><tbody><tr><td>A</td></tr></tbody></table><p data-qq-invented=""></p>',
        "<table><tbody><tr><td>A</td></tr></tbody></table>"
      )
    ).toBe(true);
  });

  it("keeps a blank line the author styled", () => {
    expect(
      holdsSameDocument(
        '<p>A</p><p style="text-align: center"></p>',
        "<p>A</p>"
      )
    ).toBe(false);
  });

  // An empty document is one empty paragraph. Reading that as scaffolding to
  // discard would make every new email differ from itself.
  it("does not read the only block in a document as scaffolding", () => {
    expect(holdsSameDocument("<p></p>", "<p></p>")).toBe(true);
    expect(holdsSameDocument("<p></p>", "<p>Written</p>")).toBe(false);
  });

  it("reports an edit", () => {
    expect(holdsSameDocument("<p>Hello!</p>", "<p>Hello</p>")).toBe(false);
    expect(
      holdsSameDocument(
        '<div style="padding:24px"><p>A</p></div>',
        '<div style="padding:25px"><p>A</p></div>'
      )
    ).toBe(false);
  });
});
