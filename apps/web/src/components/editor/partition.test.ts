import { describe, expect, it } from "vitest";
import { partitionForSchema } from "./partition.js";
import { decodeRaw } from "./raw-html-extension.js";
import { RAW_ATTRIBUTE } from "./html-dom.js";

/** The markup every raw block in `html` is standing in for, in document order. */
function frozenPayloads(html: string): string[] {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return Array.from(holder.querySelectorAll(`[${RAW_ATTRIBUTE}]`)).map(
    (element) => decodeRaw(element.getAttribute(RAW_ATTRIBUTE) ?? "")
  );
}

describe("partitionForSchema", () => {
  it("leaves ordinary rich text fully editable", () => {
    const { html, frozen } = partitionForSchema(
      "<p>Hello <strong>there</strong></p><ul><li>One</li></ul>"
    );

    expect(frozen).toBe(0);
    expect(frozenPayloads(html)).toEqual([]);
  });

  it("wraps a bare text body in a paragraph rather than freezing it", () => {
    const { html, frozen } = partitionForSchema("Just a sentence.");

    expect(frozen).toBe(0);
    expect(html).toBe("<p>Just a sentence.</p>");
  });

  // The case the old allowlist could only answer with "open this in a textarea":
  // a layout table is built from tags the schema has, and its attributes are
  // what make it a layout.
  it("keeps an email layout table editable, attributes intact", () => {
    const source =
      '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="#ffffff">' +
      '<tr><td align="center" style="padding:24px">Welcome</td></tr></table>';

    const { html, frozen } = partitionForSchema(source);

    expect(frozen).toBe(0);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('width="600"');
    expect(html).toContain('bgcolor="#ffffff"');
    // Not <td><p>Welcome</p></td>: a paragraph inside a padded cell is a
    // visible change to the spacing of a layout table.
    expect(html).toContain(">Welcome</td>");
  });

  it("keeps a div wrapper and its styling", () => {
    const source =
      '<div class="wrap" style="padding:24px;background:#f4f4f5"><p>Hi</p></div>';

    const { html, frozen } = partitionForSchema(source);

    expect(frozen).toBe(0);
    expect(html).toContain('class="wrap"');
    expect(html).toContain("padding:24px");
  });

  it("keeps a div holding only inline content without inventing a paragraph", () => {
    const { html, frozen } = partitionForSchema(
      '<div style="font-size:12px">Small print</div>'
    );

    expect(frozen).toBe(0);
    expect(html).toBe('<div style="font-size:12px">Small print</div>');
  });

  // The escape hatch. <style> has no node in the schema and never will, so it
  // is stored verbatim instead of being dropped.
  it("freezes markup the schema cannot hold, byte for byte", () => {
    const { html, frozen } = partitionForSchema(
      "<style>.x{color:red}</style><p>Hi</p>"
    );

    expect(frozen).toBe(1);
    expect(frozenPayloads(html)).toEqual(["<style>.x{color:red}</style>"]);
    // Everything around it stays editable.
    expect(html).toContain("<p>Hi</p>");
  });

  it("freezes only the offending element, not its siblings", () => {
    const { html, frozen } = partitionForSchema(
      "<p>Before</p><style>.x{}</style><p>After</p>"
    );

    expect(frozen).toBe(1);
    expect(html).toContain("<p>Before</p>");
    expect(html).toContain("<p>After</p>");
    expect(frozenPayloads(html)).toEqual(["<style>.x{}</style>"]);
  });

  it("preserves an Outlook conditional comment", () => {
    const source = "<p>A</p><!--[if mso]><i>spacer</i><![endif]--><p>B</p>";
    const { html } = partitionForSchema(source);

    expect(frozenPayloads(html).join("")).toContain("[if mso]");
  });

  it("reaches inside a wrapper to freeze one bad child", () => {
    const source =
      '<div class="wrap"><p>Keep me</p><style>.x{}</style><p>And me</p></div>';

    const { html } = partitionForSchema(source);

    expect(html).toContain('class="wrap"');
    expect(html).toContain("<p>Keep me</p>");
    expect(html).toContain("<p>And me</p>");
    expect(frozenPayloads(html)).toEqual(["<style>.x{}</style>"]);
  });

  it("never loses content, whatever it decides to freeze", () => {
    const source =
      '<div style="max-width:600px"><style>.a{}</style>' +
      '<table width="600"><tr><td><font color="#333">Legacy</font></td></tr></table>' +
      "<p>Plain</p></div>";

    const { html } = partitionForSchema(source);
    const restored = html + frozenPayloads(html).join("");

    expect(restored).toContain("Legacy");
    expect(restored).toContain(".a{}");
    expect(restored).toContain("Plain");
  });
});
