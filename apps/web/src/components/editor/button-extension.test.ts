import { Editor } from "@tiptap/core";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  BUTTON_DEFAULTS,
  buttonStyle,
  CtaButton,
  normalizeButtonAttributes,
  normalizeColor
} from "./button-extension.js";

/** Mirrors RichTextEditor's extension set — alignment lives on the paragraph,
 *  so TextAlign has to be present for these to mean anything. */
function editorWith(content = "") {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      CtaButton
    ],
    content
  });
}

/** Round-trips content through the schema the way a save/load cycle does. */
function reparse(html: string) {
  return editorWith(html).getHTML();
}

/**
 * Serializing through the DOM normalizes the style attribute (hex becomes
 * rgb(), properties gain spacing), so assert against parsed style properties
 * rather than raw substrings.
 */
function parseButton(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const anchor = doc.querySelector<HTMLAnchorElement>("a[data-qq-button]");
  if (!anchor) {
    throw new Error(`no button found in: ${html}`);
  }
  return { anchor, wrapper: anchor.parentElement as HTMLElement };
}

function rgb(hex: string) {
  const full =
    hex.length === 4 ? hex.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : hex;
  const value = parseInt(full.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

describe("buttonStyle", () => {
  it("renders inline styles, since email clients strip stylesheets", () => {
    const style = buttonStyle(BUTTON_DEFAULTS);
    expect(style).toContain("background:#2e7d63");
    expect(style).toContain("color:#ffffff");
    expect(style).toContain("border-radius:8px");
    expect(style).toContain("display:inline-block");
  });

  it("varies padding and font size by size", () => {
    const small = buttonStyle({ ...BUTTON_DEFAULTS, size: "small" });
    const large = buttonStyle({ ...BUTTON_DEFAULTS, size: "large" });
    expect(small).toContain("padding:8px 16px");
    expect(small).toContain("font-size:14px");
    expect(large).toContain("padding:16px 30px");
    expect(large).toContain("font-size:17px");
  });

  it("maps corner presets to radii", () => {
    expect(buttonStyle({ ...BUTTON_DEFAULTS, radius: "sharp" })).toContain(
      "border-radius:0"
    );
    expect(buttonStyle({ ...BUTTON_DEFAULTS, radius: "pill" })).toContain(
      "border-radius:999px"
    );
  });
});

describe("normalizeColor", () => {
  it.each(["#fff", "#ffffff", "#2E7D63"])("accepts the hex %s", (value) => {
    expect(normalizeColor(value, "#000000")).toBe(value);
  });

  // Colours are interpolated into an inline style attribute, so anything that
  // isn't a literal hex value must not reach the CSS.
  it.each([
    "red;font-size:99px",
    'red" onmouseover="alert(1)',
    "url(javascript:alert(1))",
    "",
    undefined,
    123
  ])("falls back for %s", (value) => {
    expect(normalizeColor(value, "#000000")).toBe("#000000");
  });
});

describe("normalizeButtonAttributes", () => {
  it("falls back to defaults for unknown enum values", () => {
    const attrs = normalizeButtonAttributes({
      size: "huge" as never,
      radius: "wobbly" as never
    });
    expect(attrs.size).toBe("medium");
    expect(attrs.radius).toBe("rounded");
  });

  it("keeps valid values", () => {
    const attrs = normalizeButtonAttributes({
      size: "large",
      radius: "pill",
      background: "#123456",
      label: "Go",
      href: "https://example.com"
    });
    expect(attrs).toMatchObject({
      size: "large",
      radius: "pill",
      background: "#123456",
      label: "Go",
      href: "https://example.com"
    });
  });
});

describe("CtaButton rendering", () => {
  // The button used to be a block node, which forced it onto its own line.
  it("sits beside text on the same line", () => {
    const editor = editorWith("<p>Ready to start?</p>");
    editor.commands.focus("end");
    editor.commands.insertContent(" ");
    editor.commands.setCtaButton({
      href: "https://example.com",
      label: "Get started"
    });

    const { wrapper, anchor } = parseButton(editor.getHTML());
    // One paragraph holding both the text and the button.
    expect(wrapper.tagName).toBe("P");
    expect(wrapper.textContent).toContain("Ready to start?");
    expect(anchor.textContent).toBe("Get started");
  });

  it("keeps a button beside text through a save/load round trip", () => {
    const saved =
      '<p>Ready? <a data-qq-button="true" href="https://example.com" ' +
      'data-qq-bg="#2563eb">Go</a> today</p>';

    const { wrapper, anchor } = parseButton(reparse(saved));
    expect(wrapper.textContent).toContain("Ready?");
    expect(wrapper.textContent).toContain("today");
    expect(anchor.style.background).toBe(rgb("#2563eb"));
  });

  it.each(["left", "center", "right"] as const)(
    "takes %s alignment from the line it sits on",
    (align) => {
      const editor = editorWith();
      editor.commands.setCtaButton({
        href: "https://example.com",
        label: "Go"
      });
      editor.commands.setTextAlign(align);

      const { wrapper } = parseButton(editor.getHTML());
      // TextAlign omits the style for its default alignment.
      expect(wrapper.style.textAlign || "left").toBe(align);
    }
  );

  it("applies chosen colours to the anchor", () => {
    const editor = editorWith();
    editor.commands.setCtaButton({
      href: "https://example.com",
      label: "Go",
      background: "#dc2626",
      color: "#1f2933"
    });

    const { anchor } = parseButton(editor.getHTML());
    expect(anchor.style.background).toBe(rgb("#dc2626"));
    expect(anchor.style.color).toBe(rgb("#1f2933"));
  });

  it("keeps styling and alignment through a save/load round trip", () => {
    const editor = editorWith();
    editor.commands.setCtaButton({
      href: "https://example.com",
      label: "Go",
      background: "#7c3aed",
      color: "#ffffff",
      size: "large",
      radius: "pill"
    });
    editor.commands.setTextAlign("right");

    const { anchor, wrapper } = parseButton(reparse(editor.getHTML()));
    expect(wrapper.style.textAlign).toBe("right");
    expect(anchor.style.background).toBe(rgb("#7c3aed"));
    expect(anchor.style.borderRadius).toBe("999px");
    expect(anchor.style.padding).toBe("16px 30px");
  });

  it("renders a button saved by the previous version as the original centred green", () => {
    // Buttons saved before styling existed carry no data-qq-* attributes, and
    // their alignment lived on the wrapping paragraph — which TextAlign now
    // picks up as ordinary paragraph alignment.
    const legacy =
      '<p style="text-align:center;margin:20px 0">' +
      '<a data-qq-button="true" href="https://example.com" ' +
      'style="display:inline-block;background:#2e7d63;color:#ffffff">Go</a></p>';

    const { anchor, wrapper } = parseButton(reparse(legacy));
    expect(wrapper.style.textAlign).toBe("center");
    expect(anchor.style.background).toBe(rgb("#2e7d63"));
    expect(anchor.style.borderRadius).toBe("8px");
    expect(anchor.textContent).toBe("Go");
  });

  // The previous renderer put font-weight on the anchor itself, which Bold
  // still reads back as a mark, so an old button reopens wrapped in <strong>.
  // Harmless (the label is already 600) and it settles after one pass — but
  // pinned here so the behaviour is a known quantity rather than a surprise.
  it("survives a legacy button's font-weight being read back as bold", () => {
    const legacy =
      '<p><a data-qq-button="true" href="https://example.com" ' +
      'style="display:inline-block;font-weight:600">Old</a></p>';

    const once = reparse(legacy);
    const { anchor } = parseButton(once);
    expect(anchor.textContent).toBe("Old");
    // Whatever it settles on must be stable, not accumulate on every reopen.
    expect(reparse(once)).toBe(once);
  });

  it("does not let a crafted colour escape into the style attribute", () => {
    const editor = editorWith();
    editor.commands.setCtaButton({
      href: "https://example.com",
      label: "Go",
      background: 'red" onmouseover="alert(1)' as never
    });

    const html = editor.getHTML();
    expect(parseButton(html).anchor.style.background).toBe(rgb("#2e7d63"));
    expect(html).not.toContain("onmouseover");
  });

  it("leaves an ordinary link alone", () => {
    const html = reparse('<p>See <a href="https://example.com">this</a> page</p>');
    expect(html).not.toContain("data-qq-button");
    expect(html).toContain("See ");
    expect(html).toContain("this");
  });

  // The button node is an atom that holds no content. If it ever outranked
  // Paragraph in the schema it would become the default block type, and
  // toggling lists would throw "Invalid content for node type".
  it("leaves paragraph as the default block type", () => {
    const editor = editorWith("<p>x</p>");
    editor.commands.selectAll();
    expect(() => editor.commands.toggleBulletList()).not.toThrow();
    expect(editor.getHTML()).toContain("<ul>");
  });

  it("updates a selected button in place rather than adding another", () => {
    const editor = editorWith();
    editor.commands.setCtaButton({ href: "https://example.com", label: "Go" });
    editor.commands.selectAll();
    editor.commands.updateCtaButton({ label: "Renamed", background: "#dc2626" });

    const html = editor.getHTML();
    const { anchor } = parseButton(html);
    expect(anchor.textContent).toBe("Renamed");
    expect(anchor.style.background).toBe(rgb("#dc2626"));
    expect(html.match(/data-qq-button/g)).toHaveLength(1);
  });
});
