import { CONTAINER_TAGS } from "./html-container-extension";

/** Attribute holding a raw block's base64 payload. */
export const RAW_ATTRIBUTE = "data-qq-raw";
/** Attribute marking a paragraph ProseMirror invented rather than parsed. */
export const INVENTED_ATTRIBUTE = "data-qq-invented";

/**
 * Parses `html` into a detached `<div>` without letting the parser move
 * anything.
 *
 * `div.innerHTML = html` and `new DOMParser().parseFromString(html, …)` both
 * relocate content to satisfy the HTML content model — a `<style>` is hoisted
 * into `<head>`, a bare `<tr>` is dropped outright. Either would change the
 * document before the editor ever saw it, which is the failure this whole
 * module exists to prevent. `<template>` parses in a mode that keeps everything
 * where it was written, and moving the nodes out afterwards is a DOM operation,
 * so nothing is re-parsed.
 */
export function buildHolder(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  const holder = document.createElement("div");
  holder.appendChild(template.content);
  return holder;
}

/**
 * Removes the empty paragraph at the end of editor content, if there is one.
 *
 * StarterKit's trailing node keeps one after a document that ends in something
 * the cursor can't follow — a table, an image, a raw block — so there is always
 * somewhere to carry on typing. It is an editing affordance rather than content,
 * and removing it is how editor output is compared against the document it was
 * made from.
 *
 * Two things it leaves alone: the only block in the document, since a document
 * has to hold one and that one is the content rather than scaffolding after it;
 * and a paragraph carrying attributes, which is a blank line the author styled.
 *
 * Runs after `stripInventedMarkers` — the trailing paragraph is invented like
 * any other ProseMirror creates, and is still carrying the marker before then.
 */
export function dropTrailingParagraph(holder: HTMLElement): void {
  const last = holder.lastElementChild;
  if (!last || last === holder.firstElementChild) return;
  if (last !== holder.lastChild) return;
  if (last.tagName !== "P") return;
  if (last.attributes.length > 0 || last.childNodes.length > 0) return;
  last.remove();
}

/**
 * Parents whose bare inline content ProseMirror fills with a paragraph: table
 * cells, list items, and the generic wrappers. `<li>One</li>` becomes
 * `<li><p>One</p></li>`, which is the same visible change to a list that the
 * cell case is to a table.
 */
const INLINE_ONLY_PARENTS = new Set(["td", "th", "li", ...CONTAINER_TAGS]);

const BLOCK_LEVEL = new Set([
  ...CONTAINER_TAGS,
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "style",
  "script"
]);

function isInline(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return !BLOCK_LEVEL.has((node as Element).tagName.toLowerCase());
}

/**
 * Wraps loose inline content at the top of the body in a paragraph.
 *
 * A document is a sequence of blocks, so ProseMirror wraps bare text in a
 * paragraph the moment it parses it. Doing the same to the source first means
 * the round-trip check compares like with like — otherwise a body that is
 * nothing but "Hello" reads as unrepresentable and gets frozen into a raw
 * block, which is the opposite of what should happen to the simplest possible
 * document.
 */
export function wrapTopLevelInline(holder: HTMLElement): void {
  let run: Node[] = [];

  function flush() {
    if (run.length === 0) return;
    // Whitespace between two blocks is formatting, not a paragraph.
    if (run.every((node) => (node.textContent ?? "").trim() === "" && node.nodeType === Node.TEXT_NODE)) {
      run = [];
      return;
    }
    const paragraph = document.createElement("p");
    run[0]!.parentNode?.insertBefore(paragraph, run[0]!);
    for (const node of run) {
      paragraph.appendChild(node);
    }
    run = [];
  }

  for (const child of Array.from(holder.childNodes)) {
    if (isInline(child)) {
      run.push(child);
      continue;
    }
    flush();
  }
  flush();
}

/**
 * Removes the paragraphs ProseMirror invented to fill a container that held
 * bare inline content, restoring `<td>Total</td>` from `<td><p>Total</p></td>`.
 *
 * Only when the paragraph is its parent's only child. With siblings the source
 * must have had block structure of its own, and splicing the inline content out
 * of its paragraph would run two lines together with nothing between them.
 */
export function unwrapInventedParagraphs(holder: HTMLElement): void {
  const invented = holder.querySelectorAll(`p[${INVENTED_ATTRIBUTE}]`);
  for (const paragraph of Array.from(invented)) {
    const parent = paragraph.parentElement;
    if (!parent || parent === holder) continue;
    if (!INLINE_ONLY_PARENTS.has(parent.tagName.toLowerCase())) continue;
    if (parent.childNodes.length !== 1) continue;
    // Moved rather than re-parsed from innerHTML: the nodes carry through
    // exactly, and nothing gets a second chance to normalize them.
    while (paragraph.firstChild) {
      parent.insertBefore(paragraph.firstChild, paragraph);
    }
    paragraph.remove();
  }
}

/** Drops the bookkeeping marker so it never reaches the saved HTML. */
export function stripInventedMarkers(holder: HTMLElement): void {
  for (const paragraph of Array.from(
    holder.querySelectorAll(`[${INVENTED_ATTRIBUTE}]`)
  )) {
    paragraph.removeAttribute(INVENTED_ATTRIBUTE);
  }
}
