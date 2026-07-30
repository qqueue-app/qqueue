// People type "example.com". Stored verbatim that is a *relative* URL, and a
// relative URL in an email resolves against whatever the mail client considers
// the current document — so the link either goes nowhere or somewhere wrong.
// The link and button dialogs therefore normalize what was typed instead of
// demanding a scheme, and the inputs are plain text: `type="url"` would have the
// browser reject "example.com" before the form ever submitted.

// Mirrors the protocols Tiptap's Link extension will accept (`isAllowedUri`).
// Matched as literal prefixes rather than a generic `scheme:` pattern, or
// "example.com:8080/path" would read its own host as a scheme.
const KNOWN_SCHEMES = [
  "http://",
  "https://",
  "mailto:",
  "tel:",
  "sms:",
  "callto:",
  "ftp://",
  "ftps://",
  "xmpp:",
  "cid:"
];

/** A scheme and nothing else — the "https://" stub a URL field starts life with. */
const BARE_SCHEME = /^[a-z][a-z0-9+.-]*:\/*$/i;

/** `user@host.tld`, with nothing that would make it a path or a query. */
const EMAIL_LIKE = /^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/;

/**
 * Turns whatever was typed into a link field into an address a mail client can
 * follow, or `""` when there is nothing usable there.
 *
 * Left alone: anything already carrying a known scheme, an in-page anchor, a
 * root-relative path, and a `{{variable}}` placeholder (the address is supplied
 * at send time, so prefixing it here would corrupt it). A bare email address
 * becomes `mailto:`. Everything else gets `https://`.
 */
export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value || BARE_SCHEME.test(value)) {
    return "";
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("{{") ||
    KNOWN_SCHEMES.some((scheme) =>
      value.toLowerCase().startsWith(scheme)
    )
  ) {
    return value;
  }
  if (EMAIL_LIKE.test(value)) {
    return `mailto:${value}`;
  }
  return `https://${value}`;
}
