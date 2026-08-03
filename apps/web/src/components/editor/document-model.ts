import {
  RAW_ATTRIBUTE,
  buildHolder,
  stripInventedMarkers,
  unwrapInventedParagraphs
} from "./html-dom";
import { expandPlaceholders, partitionForSchema } from "./partition";

/**
 * Everything around the body of a complete HTML document, kept as the two
 * literal strings it sits between.
 *
 * Stored rather than reconstructed on purpose. A `<head>` is full of things
 * with no in-memory representation worth building — conditional comments,
 * `<!--[if mso]>` blocks, MSO namespace declarations on `<html>`, a `<style>`
 * with client hacks in it — and anything rebuilt from parsed pieces comes back
 * subtly different. Two strings come back exactly.
 */
export interface DocumentShell {
  before: string;
  after: string;
}

const BODY_SPLIT = /^([\s\S]*?<body\b[^>]*>)([\s\S]*?)(<\/body\s*>[\s\S]*)$/i;

/**
 * Separates a complete document from its body, or reports that there is nothing
 * to separate.
 *
 * A body fragment — which is what most templates are — has no shell and is
 * returned as-is.
 */
export function splitDocument(html: string): {
  shell: DocumentShell | null;
  body: string;
} {
  const match = BODY_SPLIT.exec(html);
  if (!match) {
    return { shell: null, body: html };
  }
  return {
    shell: { before: match[1]!, after: match[3]! },
    body: match[2]!
  };
}

export function joinDocument(shell: DocumentShell | null, body: string): string {
  return shell ? `${shell.before}${body}${shell.after}` : body;
}

export interface EditorDocument {
  /** HTML to load into the rich text editor. */
  html: string;
  /** The document scaffold to put back around it, if there was one. */
  shell: DocumentShell | null;
  /** Regions the schema couldn't hold, preserved verbatim as raw blocks. */
  frozen: number;
}

/**
 * Prepares any HTML for the rich text editor.
 *
 * Nothing is rejected and nothing is lost. A complete document has its shell set
 * aside; whatever the schema can't represent becomes a raw block holding the
 * original markup; the rest stays editable. This is what replaced the old
 * decision to refuse the editor entirely for markup it couldn't hold — the
 * refusal was correct about the loss and wrong about the remedy, since it left
 * the author with no editor at all for the whole of a document that might have
 * had one bad tag in it.
 */
export function toEditorHtml(value: string): EditorDocument {
  const { shell, body } = splitDocument(value);
  const { html, frozen } = partitionForSchema(body);
  return { html, shell, frozen };
}

/**
 * Turns editor output back into the document that gets saved and sent: raw
 * blocks expanded to the markup they were standing in for, ProseMirror's
 * bookkeeping removed, and the shell put back around it.
 */
export function fromEditorHtml(
  editorHtml: string,
  shell: DocumentShell | null
): string {
  const holder = buildHolder(editorHtml);
  unwrapInventedParagraphs(holder);
  stripInventedMarkers(holder);
  expandPlaceholders(holder);
  return joinDocument(shell, holder.innerHTML);
}

/**
 * How many raw blocks editor content is currently holding. Read from the live
 * editor HTML rather than remembered from the split, so it stays true after one
 * is inserted or deleted.
 */
export function countRawBlocks(editorHtml: string): number {
  return buildHolder(editorHtml).querySelectorAll(`[${RAW_ATTRIBUTE}]`).length;
}
