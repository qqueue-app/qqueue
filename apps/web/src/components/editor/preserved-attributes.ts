import { Extension } from "@tiptap/core";
import { EMAIL_NEUTRALS } from "../../lib/email-palette.js";

/**
 * Presentational attributes carried through the editor untouched.
 *
 * ProseMirror keeps exactly the attributes a node declares and silently drops
 * the rest, which is what turned hand-written email HTML into something the
 * editor couldn't hold: the classic layout table
 * (`<table role="presentation" cellpadding="0" width="600" bgcolor="#fff">`) is
 * built entirely from tags the schema already has, and used to arrive stripped
 * of every attribute that made it a layout.
 *
 * These are the attributes email HTML actually uses to lay itself out. They are
 * inert data — no event handlers, no `src`/`href` (those are declared by the
 * nodes that own them) — so preserving them adds no new way for markup to act.
 */
const PRESERVED = [
  "style",
  "class",
  "id",
  "title",
  "dir",
  "lang",
  "role",
  "align",
  "valign",
  "bgcolor",
  "background",
  "width",
  "height",
  "border",
  "cellpadding",
  "cellspacing"
] as const;

/**
 * Nodes that gain the attributes above. Every block-level node in the schema is
 * here: an attribute the schema drops on *any* node makes the document that
 * contains it unrepresentable, and it then has to fall back to a raw block.
 */
const TARGET_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "horizontalRule",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "htmlBlock",
  "htmlText"
];

/**
 * Inline styling applied to nodes the *toolbar* creates, so a table inserted
 * from the toolbar still arrives with visible borders in a mail client (which
 * strips `<style>` blocks, so class-based styling would arrive bare).
 *
 * These are node attribute defaults rather than static `HTMLAttributes` on the
 * extension config, and the difference is the whole point. Static attributes are
 * merged into *every* node of that type on render, so a pasted
 * `<table cellpadding="0">` would come back out carrying styling it never had —
 * which fails the round-trip check and demotes the table to an opaque block.
 * A default applies only when nothing was parsed, so:
 *
 * - inserted from the toolbar → no parse, default applies, borders show
 * - pasted carrying `style` → parsed value wins, byte-identical on the way out
 * - pasted carrying none     → `parseHTML` yields "", which beats the default
 */
const STYLE_DEFAULTS: Record<string, string> = {
  table: `border-collapse:collapse;width:100%;border:1px solid ${EMAIL_NEUTRALS.border}`,
  tableCell: `border:1px solid ${EMAIL_NEUTRALS.border};padding:6px 10px;vertical-align:top`,
  // No `font-weight` here, deliberately. Bold parses a font-weight *style* back
  // into a mark, whatever element carries it, so a header cell declaring one
  // made everything inside it bold again on every reopen — the same trap the
  // CTA button hit, which is why its weight lives on the inner label span. A
  // `<th>` is bold in every renderer's default stylesheet anyway.
  tableHeader: `border:1px solid ${EMAIL_NEUTRALS.border};padding:6px 10px;vertical-align:top;background-color:${EMAIL_NEUTRALS.sunken};text-align:left`,
  image: "max-width:100%;height:auto"
};

export const PreservedAttributes = Extension.create({
  name: "preservedAttributes",

  addGlobalAttributes() {
    // One entry per node type, each declaring every attribute once. Declaring
    // them across two entries — the shared set, then an override for the four
    // types with a style default — leaves it to Tiptap which of the two
    // definitions of `style` wins, and the answer is not the override.
    return TARGET_TYPES.map((type) => ({
      types: [type],
      attributes: Object.fromEntries(
        PRESERVED.map((attribute) => {
          const fallback = attribute === "style" ? STYLE_DEFAULTS[type] : undefined;
          return [
            attribute,
            {
              default: fallback ?? null,
              parseHTML: (element: HTMLElement) =>
                element.getAttribute(attribute) ??
                // Absent is normally null. Where there *is* a default it has to
                // be "" instead: null lets ProseMirror fall back to the
                // default, which would stamp the toolbar's table styling onto a
                // pasted table that deliberately had none. Used no wider than
                // that, because an attribute another extension also declares
                // (`title` on an image) renders through that extension's rule,
                // and "" is not absent to it — the image came back carrying
                // `title=""` it never had.
                (fallback === undefined ? null : ""),
              renderHTML: (attributes: Record<string, unknown>) => {
                const value = attributes[attribute];
                return value ? { [attribute]: value } : {};
              }
            }
          ];
        })
      )
    }));
  }
});

/**
 * Marks a paragraph ProseMirror invented rather than one that was in the source.
 *
 * Table cells hold block content, so parsing `<td>Total</td>` wraps that text in
 * a paragraph that was never written — and `<td><p>Total</p></td>` on the way
 * back out is a real change to a layout table's spacing, enough to demote the
 * whole table to an opaque block. The flag distinguishes the two cases so the
 * serializer can unwrap the invented ones (see `unwrapInventedParagraphs`).
 *
 * The default is `true` and `parseHTML` always returns `false`, which reads
 * backwards until you notice that `parseHTML` runs *only* for paragraphs that
 * exist in the source. Anything ProseMirror creates on its own — filling a cell,
 * or the user pressing Enter — never reaches it and keeps the default.
 */
export const InventedParagraph = Extension.create({
  name: "inventedParagraph",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          invented: {
            default: true,
            parseHTML: () => false,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.invented ? { "data-qq-invented": "" } : {}
          }
        }
      }
    ];
  }
});
