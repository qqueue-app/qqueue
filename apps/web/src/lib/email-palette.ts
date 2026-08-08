/**
 * The design tokens, as hex, for the places a CSS custom property cannot reach.
 *
 * Two of those exist and both are unavoidable:
 *
 *   1. **Sandboxed preview iframes.** A `srcdoc` document is its own document.
 *      `:root` in styles.css does not cascade into it, so its stylesheet has to
 *      carry literal values.
 *   2. **Email HTML itself.** Anything the composer writes into a message ends
 *      up in Gmail, Outlook and Apple Mail, none of which resolve
 *      `var(--accent)`. A custom property in a CTA button is a button with no
 *      colour at all.
 *
 * So these are hex on purpose — but they are hex *in one place*, mirroring
 * styles.css, rather than scattered across eight files. Before this existed the
 * editor's green (`#2e7d63`) was not the brand green, the preview surfaces used
 * cool zinc against a warm-gray app, and three files disagreed about what
 * "muted text" meant.
 *
 * **When you change a colour in styles.css, change its twin here.** There is no
 * mechanism that can do it for you; that is the cost of the two contexts above.
 */

/** Warm-gray neutrals — the hex twins of `--text`, `--border`, and friends. */
export const EMAIL_NEUTRALS = {
  /** `--text` #1A1D1B — body copy inside a message. */
  text: "#1A1D1B",
  /** `--text-secondary` #5C615E — quoted text, captions. */
  textMuted: "#5C615E",
  /** `--border` #E7E6E2 — rules, table hairlines, blockquote bars. */
  border: "#E7E6E2",
  /** `--surface-sunken` #F4F4F1 — table header fill. */
  sunken: "#F4F4F1",
  /** `--bg` #FAFAF8 — the backdrop a preview floats the message on. */
  backdrop: "#FAFAF8",
  /** `--email-paper` #FFFFFF — the message itself. */
  paper: "#FFFFFF"
} as const;

/**
 * Colours a person can pick for text and CTA buttons.
 *
 * The first entry is the brand green — the same `--accent` the app's own
 * buttons wear. It was `#2e7d63` here and `#1F5C4D` everywhere else, which made
 * every CTA QQueue composed subtly off-brand from the product that sent it.
 */
export const EMAIL_ACCENT = "#1F5C4D";

/** Link blue for received mail — `--info-text`, the one status colour a mail client expects. */
export const EMAIL_LINK = "#2A5AA8";

/**
 * The swatch set offered by the text-colour picker and the button dialog.
 * Deliberately short: a palette with thirty options is how an email ends up
 * looking like a ransom note.
 */
export const EMAIL_SWATCHES = {
  accent: EMAIL_ACCENT,
  ink: EMAIL_NEUTRALS.text,
  muted: EMAIL_NEUTRALS.textMuted,
  blue: EMAIL_LINK,
  /** `--err-text` */
  red: "#A03024",
  /** `--warn-text` */
  amber: "#8A5B10",
  /** No token twin: the one hue the system has no use for, kept because a
      person composing a newsletter reasonably wants it. */
  violet: "#6D3FBF",
  white: EMAIL_NEUTRALS.paper
} as const;
