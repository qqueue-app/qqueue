import { mergeAttributes, Node } from "@tiptap/core";

export interface ButtonAttributes {
  href: string;
  label: string;
}

// Inline styles are required: email clients strip <style>/class rules, so the
// button must carry its appearance on the element itself.
const BUTTON_STYLE = [
  "display:inline-block",
  "background:#2e7d63",
  "color:#ffffff",
  "padding:12px 22px",
  "border-radius:8px",
  "text-decoration:none",
  "font-weight:600",
  "font-size:15px"
].join(";");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ctaButton: {
      /** Insert a call-to-action button block. */
      setCtaButton: (attrs: ButtonAttributes) => ReturnType;
    };
  }
}

/**
 * A block-level call-to-action button rendered as an email-safe, inline-styled
 * anchor. Stored in the document as `<a data-qq-button>` so it round-trips
 * through the template HTML and survives the send pipeline unchanged.
 */
export const CtaButton = Node.create({
  name: "ctaButton",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: "https://" },
      label: { default: "Click here" }
    };
  },

  parseHTML() {
    return [{ tag: "a[data-qq-button]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { href, label, ...rest } = HTMLAttributes as ButtonAttributes &
      Record<string, unknown>;
    return [
      "p",
      { style: "text-align:center;margin:20px 0" },
      [
        "a",
        mergeAttributes(rest, {
          href,
          "data-qq-button": "true",
          target: "_blank",
          rel: "noopener noreferrer",
          style: BUTTON_STYLE
        }),
        label
      ]
    ];
  },

  addCommands() {
    return {
      setCtaButton:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs })
    };
  }
});
