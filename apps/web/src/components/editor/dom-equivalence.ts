/**
 * Comparing "is this the same markup?" the way a mail client would see it.
 *
 * The partitioner works by parsing HTML through the editor's schema, serializing
 * it back, and asking whether anything changed. That question needs an answer
 * that ignores the differences a DOM round-trip always produces — attribute
 * order, quoting, `<br>` vs `<br/>`, the newlines between block tags — while
 * catching every difference that would move a pixel.
 *
 * Where the two are hard to tell apart the comparison says "different". A false
 * difference costs editability: the markup is preserved verbatim in a raw block
 * instead of being editable in place. A false match costs the author's layout.
 */

/** Tags whose children are laid out as blocks, so the newlines between them
 *  are formatting rather than content. */
const BLOCK_TAGS = new Set([
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "center",
  "figure",
  "address",
  "body",
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
  "dl",
  "dt",
  "dd",
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
  "colgroup",
  "col"
]);

function tagOf(node: Node): string {
  return (node as Element).tagName?.toLowerCase() ?? "";
}

/** Nodes that can be frozen into a raw block on their own. */
function blameable(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.COMMENT_NODE
  );
}

/** Collapses runs of whitespace the way HTML rendering does. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * True when whitespace-only text directly inside `parent` is formatting rather
 * than content — i.e. the parent lays its children out as blocks, so the
 * newlines between them never render.
 *
 * Inside a paragraph the same whitespace is load-bearing: dropping it would
 * call `<b>a</b> <b>b</b>` and `<b>a</b><b>b</b>` the same markup.
 */
function separatesBlocks(parent: Element): boolean {
  return Array.from(parent.children).some((child) =>
    BLOCK_TAGS.has(tagOf(child))
  );
}

/** Children with formatting whitespace and empty text removed. */
function significantChildren(parent: Element): Node[] {
  const dropWhitespace = separatesBlocks(parent);
  return Array.from(parent.childNodes).filter((child) => {
    if (child.nodeType !== Node.TEXT_NODE) return true;
    const text = child.textContent ?? "";
    if (text.trim() !== "") return true;
    return !dropWhitespace && text !== "";
  });
}

let styleProbe: HTMLElement | null = null;

/**
 * A style attribute reduced to its declarations, order and spacing aside.
 *
 * Run through the CSSOM first, because writing a style attribute rewrites its
 * value and the rewriting differs by engine — `#f4f4f5` comes back as
 * `rgb(244, 244, 245)`, `padding:24px` as `padding: 24px`. Comparing the raw
 * strings would report a difference that only exists in the spelling, and freeze
 * a perfectly editable wrapper. Both sides go through the same pass, so whatever
 * the engine does to one it does to the other.
 *
 * Declarations the CSSOM doesn't recognise (`mso-padding-alt`, and the rest of
 * the Outlook vocabulary) are dropped by that pass — equally on both sides, and
 * the attribute itself is still carried through verbatim, so nothing is lost by
 * leaving them out of the comparison.
 */
function normalizeStyle(value: string): string {
  styleProbe ??= document.createElement("div");
  styleProbe.style.cssText = "";
  styleProbe.style.cssText = value;
  return declarations(styleProbe.style.cssText || value);
}

function declarations(value: string): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) return declaration.toLowerCase();
      return `${declaration.slice(0, colon).trim().toLowerCase()}:${declaration
        .slice(colon + 1)
        .trim()}`;
    })
    .sort()
    .join(";");
}

function normalizeAttribute(name: string, value: string): string {
  if (name === "style") return normalizeStyle(value);
  if (name === "class") return value.trim().split(/\s+/).filter(Boolean).sort().join(" ");
  return value.trim();
}

function attributeMap(element: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = normalizeAttribute(name, attribute.value);
    // An attribute normalized to nothing (`style=""`, `class="  "`) renders the
    // same as one that was never there, and the serializer routinely produces
    // one from the other.
    if (value === "") continue;
    map.set(name, value);
  }
  return map;
}

function attributesMatch(a: Element, b: Element): boolean {
  const left = attributeMap(a);
  const right = attributeMap(b);
  if (left.size !== right.size) return false;
  for (const [name, value] of left) {
    if (right.get(name) !== value) return false;
  }
  return true;
}

/**
 * The node in `input` responsible for the first difference against `output`, or
 * null when the two are equivalent.
 *
 * The partitioner uses what comes back as the thing to freeze into a raw block,
 * so this deliberately reports the *smallest* thing it can blame: the smaller
 * the frozen subtree, the more of the document stays editable. Usually that is
 * an element, but a comment is blamed as itself — the schema has nowhere to put
 * one, and blaming the element around it costs the editability of a whole
 * section for a `<!-- header -->` label or an `<!--[if mso]>` block, which email
 * HTML is full of.
 *
 * A stray text node stays the parent's problem. There is no useful thing to
 * freeze it into, and where it is load-bearing the parent is what has to be
 * preserved anyway.
 */
export function findDivergence(input: Element, output: Element | null): Node | null {
  if (!output) return input;
  if (tagOf(input) !== tagOf(output)) return input;
  if (!attributesMatch(input, output)) return input;

  const left = significantChildren(input);
  const right = significantChildren(output);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const before = left[index];
    const after = right[index];

    // The serializer produced something with no counterpart in the source —
    // nothing in the input to blame for it, so the parent takes it.
    if (!before) return input;
    // The source had something the serializer didn't emit, or emitted something
    // else in its place. Blame it if it is a thing that can be frozen on its
    // own; a text node is the parent's problem.
    if (!after || before.nodeType !== after.nodeType) {
      return blameable(before) ? before : input;
    }
    if (before.nodeType === Node.TEXT_NODE) {
      if (collapse(before.textContent ?? "") !== collapse(after.textContent ?? "")) {
        return input;
      }
      continue;
    }
    if (before.nodeType !== Node.ELEMENT_NODE) {
      // A comment that survived but came back saying something else.
      if ((before.textContent ?? "") !== (after.textContent ?? "")) {
        return blameable(before) ? before : input;
      }
      continue;
    }

    const deeper = findDivergence(before as Element, after as Element);
    if (deeper) return deeper;
  }

  return null;
}

/** True when the two trees would render identically. */
export function domEquivalent(input: Element, output: Element | null): boolean {
  return findDivergence(input, output) === null;
}
