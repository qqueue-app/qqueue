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

// Tags the rich text editor's ProseMirror schema has no node or mark for. When
// the source contains one, switching to rich text silently deletes it — worth a
// warning naming the actual casualties rather than a vague "you may lose
// formatting".
const UNSUPPORTED_TAGS = [
  "style",
  "script",
  "head",
  "meta",
  "link",
  "title",
  "iframe",
  "form",
  "input",
  "button",
  "video",
  "audio",
  "svg"
];

/**
 * Tags in `html` that the rich text editor would drop on the way in. Returned in
 * source order, deduplicated, so the switch-to-rich-text warning can list them.
 */
export function unsupportedInRichText(html: string): string[] {
  return UNSUPPORTED_TAGS.filter((tag) =>
    new RegExp(`<${tag}[\\s/>]`, "i").test(html)
  );
}
