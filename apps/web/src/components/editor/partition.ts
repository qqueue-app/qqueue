import { DOMParser as PMDOMParser, DOMSerializer } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import { editorSchema } from "./editor-extensions";
import { findDivergence } from "./dom-equivalence";
import {
  RAW_ATTRIBUTE,
  buildHolder,
  stripInventedMarkers,
  unwrapInventedParagraphs,
  wrapTopLevelInline
} from "./html-dom";
import { decodeRaw, encodeRaw } from "./raw-html-extension";

/**
 * Every pass freezes one more element, so this only bounds pathological input —
 * a document with more distinct broken regions than this is one nobody is going
 * to edit block by block anyway, and it falls back to a single raw block.
 */
const MAX_PASSES = 60;

/**
 * Runs a candidate document through the editor's schema and back, in the exact
 * form the editor would produce.
 *
 * The two post-processing steps are the same ones `fromEditorHtml` applies to
 * real editor output. They have to be, or the check would compare the source
 * against markup that is not what gets saved, and freeze content that would
 * have round-tripped perfectly well.
 */
function roundTrip(holder: HTMLElement, schema: Schema): HTMLElement {
  const parsed = PMDOMParser.fromSchema(schema).parse(holder);
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
    parsed.content
  );
  const output = document.createElement("div");
  output.appendChild(fragment);
  unwrapInventedParagraphs(output);
  stripInventedMarkers(output);
  return output;
}

/**
 * The markup an element stands for, with any raw blocks already inside it put
 * back.
 *
 * Freezing something that contains an earlier raw block would otherwise store
 * the *placeholder* as the payload, and the markup it was standing in for would
 * be gone — the one outcome this module exists to make impossible.
 */
export function expandPlaceholders(root: Element): void {
  for (const placeholder of Array.from(
    root.querySelectorAll(`[${RAW_ATTRIBUTE}]`)
  )) {
    const restored = buildHolder(
      decodeRaw(placeholder.getAttribute(RAW_ATTRIBUTE) ?? "")
    );
    placeholder.replaceWith(...Array.from(restored.childNodes));
  }
}

function markupOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  expandPlaceholders(clone);
  return clone.outerHTML;
}

function placeholderFor(html: string): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.setAttribute(RAW_ATTRIBUTE, encodeRaw(html));
  return placeholder;
}

/** Replaces an element with a raw block holding its markup verbatim. */
function freeze(element: Element): void {
  element.replaceWith(placeholderFor(markupOf(element)));
}

/** Replaces everything in `holder` with a single raw block. */
function freezeAll(holder: HTMLElement): void {
  const clone = holder.cloneNode(true) as HTMLElement;
  expandPlaceholders(clone);
  holder.replaceChildren(placeholderFor(clone.innerHTML));
}

function isFrozen(element: Element): boolean {
  return element.hasAttribute(RAW_ATTRIBUTE);
}

export interface PartitionResult {
  /** HTML to hand the editor: the original, with frozen regions as raw blocks. */
  html: string;
  /** How many regions had to be frozen. Zero means fully editable. */
  frozen: number;
}

/**
 * Splits a document into the parts the editor can hold and the parts it can't,
 * without losing either.
 *
 * The question "can the editor represent this?" used to be answered from a
 * hand-written list of tags and attributes, which is a second copy of the schema
 * that drifts from it. This asks the schema itself: parse the document, serialize
 * it back, and compare. Whatever came back different is wrapped in a raw block
 * that stores the original markup verbatim, and the pass runs again on what is
 * left. Anything the schema handles perfectly stays fully editable.
 *
 * That inverts the old trade-off. There is no longer a choice between opening a
 * document in an editor that will rewrite it and freezing the whole thing behind
 * a source view — only the parts that would actually be rewritten are frozen,
 * and everything around them can be typed into.
 */
export function partitionForSchema(
  html: string,
  schema: Schema = editorSchema()
): PartitionResult {
  // An empty body has nothing to check and nothing to lose, and it is the most
  // common state a composer is in. Left to the loop below it would fail the
  // comparison — a document must contain at least one block, so ProseMirror
  // supplies an empty paragraph the source didn't have — and get frozen, which
  // would mean starting every new email inside a raw block.
  if (html.trim() === "") {
    return { html, frozen: 0 };
  }

  const holder = buildHolder(html);
  // Bookkeeping, not content. `fromEditorHtml` clears it on the way out so a
  // saved document never carries one, but raw editor output does — and left in
  // place it is an attribute the round-trip removes, which reads as a
  // difference and freezes content the editor itself just produced.
  stripInventedMarkers(holder);
  wrapTopLevelInline(holder);

  let frozen = 0;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const offender = findDivergence(holder, roundTrip(holder, schema));
    if (!offender) {
      return { html: holder.innerHTML, frozen };
    }

    // The divergence is about the body as a whole — content appearing or
    // disappearing at the top level rather than inside any one element. There
    // is no smaller thing to blame.
    if (offender === holder) break;

    // Already verbatim and still reported as different: the problem is where it
    // sits, not what it holds. Widen to the parent rather than loop forever.
    const target = isFrozen(offender)
      ? offender.parentElement
      : offender;
    if (!target || target === holder) break;

    freeze(target);
    frozen += 1;
  }

  // Nothing smaller worked. One block for the whole body still loses nothing —
  // it just can't be typed into.
  freezeAll(holder);
  return { html: holder.innerHTML, frozen: 1 };
}
