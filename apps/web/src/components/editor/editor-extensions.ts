import { getSchema, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Image from "@tiptap/extension-image";
import { CtaButton } from "./button-extension";
import {
  EmailTable,
  EmailTableCell,
  EmailTableHeader,
  EmailTableRow
} from "./table-extension";
import { HtmlBlock, HtmlText } from "./html-container-extension";
import { InventedParagraph, PreservedAttributes } from "./preserved-attributes";
import { RawHtml } from "./raw-html-extension";

/**
 * The one extension list. Both the editor and the partitioner that decides what
 * the editor can hold are built from it, and they have to agree exactly: the
 * partitioner works by parsing markup through this schema and checking what
 * comes back, so a schema that differs by one extension would either hand the
 * editor content it destroys, or freeze content it could have edited.
 *
 * That replaces the hand-maintained tag and attribute allowlists this module
 * used to carry. An allowlist is a second description of the schema that has to
 * be kept in step with it by hand, and drifts the first time an extension is
 * added; asking the schema directly cannot drift.
 *
 * Order matters. StarterKit comes first so `paragraph` is the first block node
 * registered, which is the one ProseMirror creates by default — putting the
 * generic containers or the raw-HTML atom ahead of it would make one of those
 * the default block and break Enter and lists.
 */
export function createExtensions(
  options: { placeholder?: string } = {}
): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true }
    }),
    Placeholder.configure({
      placeholder: options.placeholder ?? "Write your email…"
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    Color,
    // The email-safe inline styling these used to declare as static
    // `HTMLAttributes` now lives in `PreservedAttributes` as node attribute
    // defaults. Static attributes are stamped onto every node of the type on
    // render, which would add styling to a pasted table that never had any and
    // break its round-trip; a default applies only when nothing was parsed.
    Image.configure({ inline: false }),
    // Without these nodes in the schema, ProseMirror silently drops table
    // markup on paste — a pasted table was flattened to paragraphs before it
    // ever reached the send pipeline. Listed individually rather than through
    // TableKit because they are the trimmed versions (see table-extension.ts).
    EmailTable,
    EmailTableRow,
    EmailTableCell,
    EmailTableHeader,
    CtaButton,
    HtmlBlock,
    HtmlText,
    RawHtml,
    PreservedAttributes,
    InventedParagraph
  ];
}

let cached: ReturnType<typeof getSchema> | null = null;

/**
 * The schema those extensions describe, built once. The partitioner parses
 * every candidate through it, so this is on the hot path of opening a document.
 */
export function editorSchema() {
  cached ??= getSchema(createExtensions());
  return cached;
}
