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
 * apply.
 *
 * It used to also decide that such a document could not be edited as rich text.
 * That is no longer true — its scaffold is set aside and restored around
 * whatever the editor produces (see document-model.ts) — so this now says only
 * what it says: how the document will be sent.
 */
export function isFullHtmlDocument(html: string): boolean {
  return FULL_DOCUMENT_MARKERS.some((marker) => marker.test(html));
}
