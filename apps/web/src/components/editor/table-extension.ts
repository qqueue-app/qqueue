import { mergeAttributes } from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow
} from "@tiptap/extension-table";

/**
 * The table nodes, trimmed to render only what was actually written.
 *
 * Tiptap's tables are built for a document editor, where the extra scaffolding
 * they emit is invisible. In an email it is not: the stock nodes add a
 * `<colgroup>`, a `min-width` on the table, and `colspan="1" rowspan="1"` on
 * every cell, none of which the author wrote. That markup is harmless to look at
 * and fatal to the round-trip — a pasted layout table comes back different from
 * how it went in, so it gets frozen into a raw block and stops being editable.
 * Cutting the scaffolding is what lets those tables stay editable.
 *
 * The output is also simply better email: `<colgroup>` support is patchy across
 * mail clients, and a `min-width` on a layout table fights the width the author
 * set on it.
 */

/** Renders a span only when it isn't the implied 1. */
function spanAttribute(name: "colspan" | "rowspan") {
  return {
    default: 1,
    parseHTML: (element: HTMLElement) => {
      const value = Number.parseInt(element.getAttribute(name) ?? "", 10);
      return Number.isFinite(value) && value > 0 ? value : 1;
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[name] && attributes[name] !== 1
        ? { [name]: attributes[name] }
        : {}
  };
}

/**
 * Turns off Tiptap's derived cell alignment.
 *
 * It reads `align="center"` off a cell and re-emits it as an added
 * `text-align: center` declaration, so a cell arrives carrying both the
 * attribute and a style it never had. The attribute itself is already carried
 * through untouched by the preserved-attributes extension, which is the
 * faithful way to do it.
 */
const INERT_ALIGN = {
  default: null,
  parseHTML: () => null,
  renderHTML: () => ({})
};

export const EmailTable = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "table",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      ["tbody", 0]
    ];
  }
}).configure({ resizable: false });

export const EmailTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: spanAttribute("colspan"),
      rowspan: spanAttribute("rowspan"),
      align: INERT_ALIGN
    };
  }
});

export const EmailTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: spanAttribute("colspan"),
      rowspan: spanAttribute("rowspan"),
      align: INERT_ALIGN
    };
  }
});

export const EmailTableRow = TableRow;
