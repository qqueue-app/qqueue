// Mirrors `isFullHtmlDocument` in @qqueue/email-engine (render/mjml.ts), the
// same way variables.ts mirrors the shared substitution helpers: the web app
// deliberately doesn't pull in workspace packages, and this check is a handful
// of regexes. Keep the two in sync — the server uses it to decide whether to
// bypass the MJML wrap, and the UI uses it to say so before you hit send.

const FULL_DOCUMENT_MARKERS = [
  /<!doctype\s+html/i,
  /<html[\s/>]/i,
  /<body[\s/>]/i
];

/**
 * True when `html` is a complete HTML document rather than a body fragment.
 *
 * A complete document is sent verbatim: it already carries its own head/body
 * scaffold, so the server skips the MJML email-safe wrapper it would otherwise
 * apply. It also can't survive a round-trip through the rich text editor, whose
 * schema has no concept of <html>/<head>/<style>.
 */
export function isFullHtmlDocument(html: string): boolean {
  return FULL_DOCUMENT_MARKERS.some((marker) => marker.test(html));
}

/**
 * Every tag the rich text editor's ProseMirror schema can hold — the output of
 * `editor.getHTML()` is drawn entirely from this set.
 *
 * An allowlist rather than a list of known-bad tags, because the failure is not
 * limited to tags that get *deleted*. `<div>` is quietly rewritten to `<p>`,
 * `<font>` collapses to its text, and the inline styles and classes on a
 * hand-written email layout go with them. Both are the same loss to the person
 * who wrote the markup, so both have to count as "can't hold this".
 */
const RICH_TEXT_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "strike",
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
  "code",
  "hr",
  "a",
  "img",
  "span",
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

/**
 * Every attribute the editor's schema carries through. `data-*` is open because
 * the CTA button stores its styling there.
 *
 * The tag list alone isn't enough to spot hand-written email HTML: the classic
 * layout table — `<table border="0" cellpadding="0" width="600">` — is built
 * entirely from tags the schema *does* have, and arrives stripped of every
 * attribute that made it a layout. So the attributes count too.
 */
const RICH_TEXT_ATTRS = new Set([
  "href",
  "target",
  "rel",
  "src",
  "alt",
  "title",
  "style",
  "start",
  "type",
  "colspan",
  "rowspan"
]);

/** An opening tag: name, then attributes, with quoted values kept intact. */
const OPEN_TAG = /<\s*([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>?/gi;
const ATTR_NAME = /([a-z_:][a-z0-9_:.-]*)\s*=/gi;

export interface RichTextCasualties {
  /** Tags with no node or mark in the schema. */
  tags: string[];
  /** Attributes the schema drops, on tags it otherwise keeps. */
  attributes: string[];
}

/**
 * What `html` would lose on the way into the rich text editor, in source order
 * and deduplicated, so the switch-to-rich-text warning can name the actual
 * casualties rather than say a vague "you may lose formatting".
 */
export function unsupportedInRichText(html: string): RichTextCasualties {
  const tags = new Set<string>();
  const attributes = new Set<string>();

  for (const [, name, rawAttrs] of html.matchAll(OPEN_TAG)) {
    if (!RICH_TEXT_TAGS.has(name!.toLowerCase())) {
      tags.add(name!.toLowerCase());
      // Everything inside a tag the editor deletes goes with it; listing its
      // attributes separately would just be noise.
      continue;
    }
    for (const [, attr] of (rawAttrs ?? "").matchAll(ATTR_NAME)) {
      const lower = attr!.toLowerCase();
      if (!lower.startsWith("data-") && !RICH_TEXT_ATTRS.has(lower)) {
        attributes.add(lower);
      }
    }
  }

  return { tags: [...tags], attributes: [...attributes] };
}

/**
 * True when `html` would survive a trip through the rich text editor unchanged.
 *
 * This decides which view a body *opens* in. Mounting the editor over markup it
 * can't represent is destructive on sight: ProseMirror parses the HTML into its
 * own schema, and from then on the document is whatever the schema could hold.
 * So content that fails this check has to open in the source view — a template
 * saved as raw HTML otherwise came back rewritten, which read as the save having
 * silently failed.
 */
export function richTextCanRepresent(html: string): boolean {
  if (isFullHtmlDocument(html)) {
    return false;
  }
  const { tags, attributes } = unsupportedInRichText(html);
  return tags.length === 0 && attributes.length === 0;
}
