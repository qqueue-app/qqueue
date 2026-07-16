import mjml2html from "mjml";

// Email-safe HTML rendering via MJML.
//
// MJML compiles to table-based, inline-CSS HTML that renders consistently across
// Outlook, Gmail, and other clients where raw editor HTML (e.g. Tiptap output)
// breaks. This module is introduced in Phase A as an OPT-IN utility: it is not
// wired into the default campaign/transactional send path, so existing HTML
// sends are byte-for-byte unchanged. Phase B adopts it behind the composer.
//
// Intended Phase B pipeline (note the ordering):
//   Tiptap HTML -> MJML document -> renderMjml() -> email-safe HTML
//     -> injectTracking() -> store on EmailJob.html
// Tracking MUST be injected AFTER MJML rendering so the pixel/link rewriting
// operates on the final email-safe markup, not on pre-compiled MJML.

export interface RenderMjmlOptions {
  /**
   * How MJML validates the document.
   * - "soft" (default): render even when validation reports issues.
   * - "strict": throw on any validation error (caller gets the fallback).
   * - "skip": no validation.
   */
  validationLevel?: "strict" | "soft" | "skip";
  /** Minify the rendered HTML. Defaults to false. */
  minify?: boolean;
  /**
   * HTML returned when compilation throws. Defaults to the raw MJML source so a
   * malformed document never takes the send pipeline down.
   */
  fallbackHtml?: string;
}

export interface RenderMjmlResult {
  /** Email-safe HTML, or `fallbackHtml`/source when compilation failed. */
  html: string;
  /** Human-readable validation/parse messages; empty when there are none. */
  errors: string[];
  /** True when compilation threw and the fallback HTML was returned. */
  usedFallback: boolean;
}

/**
 * Compile an MJML document into email-safe HTML. Never throws: on a hard parse
 * failure it returns `fallbackHtml` (or the original source) with `usedFallback`
 * set, so callers can degrade gracefully instead of failing a send.
 */
export async function renderMjml(
  source: string,
  options: RenderMjmlOptions = {}
): Promise<RenderMjmlResult> {
  const { validationLevel = "soft", minify = false, fallbackHtml } = options;

  try {
    const result = await mjml2html(source, { validationLevel, minify });
    return {
      html: result.html,
      errors: result.errors.map((error) => error.formattedMessage),
      usedFallback: false
    };
  } catch (error) {
    return {
      html: fallbackHtml ?? source,
      errors: [
        error instanceof Error ? error.message : "Unknown MJML rendering error"
      ],
      usedFallback: true
    };
  }
}

/**
/** Branding applied to the email-safe layout. All fields are optional. */
export interface EmailBranding {
  /**
   * Brand/product name shown in the header wordmark and footer copyright. When
   * omitted, NO header or copyright line is rendered (no default vendor name).
   */
  brandName?: string;
  /** Absolute URL to a logo image. When set, replaces the text wordmark. */
  logoUrl?: string;
  /** Accent colour (links, blockquote rule) as a CSS colour. Defaults to moss green. */
  accentColor?: string;
  /** Small print shown under the footer (e.g. a postal address). */
  footerNote?: string;
  /** When set, renders an "Unsubscribe" link in the footer pointing here. */
  unsubscribeUrl?: string;
}

// Only the link/accent colour has a default. The brand wordmark and copyright
// footer are intentionally NOT defaulted: outbound mail from a self-hosted
// install must never be stamped with "QQueue" (or any vendor name) unless the
// sender explicitly opts in via `branding`.
const DEFAULT_ACCENT = "#2e7d63";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap arbitrary body HTML (e.g. editor/template output) in an email-safe MJML
 * document: the body padded on the client's default background, with no card or
 * page tint. The author's HTML is passed through verbatim inside an `<mj-text>`
 * block so its own markup survives; the surrounding scaffold supplies the
 * email-safe table/column structure plus typography defaults that make plain
 * editor output look intentional.
 *
 * A brand header and a copyright/unsubscribe footer are added ONLY when the
 * caller supplies the corresponding `branding` fields — by default the document
 * contains nothing but the sender's own content (no vendor name is injected).
 */
export function wrapHtmlInMjml(
  bodyHtml: string,
  branding: EmailBranding = {}
): string {
  const brandName = branding.brandName?.trim();
  const accent = branding.accentColor?.trim() || DEFAULT_ACCENT;
  const safeBrand = brandName ? escapeHtml(brandName) : "";

  // Header is opt-in: rendered only when a logo or brand name is supplied.
  const headerInner = branding.logoUrl
    ? `<mj-image src="${branding.logoUrl}" alt="${safeBrand}" align="center" width="160px" padding="0" />`
    : brandName
      ? `<mj-text align="center" font-size="22px" font-weight="700" letter-spacing="-0.01em" color="${accent}" padding="0">${safeBrand}</mj-text>`
      : "";

  const header = headerInner
    ? [
        `    <mj-section padding="28px 0 12px">`,
        "      <mj-column>",
        `        ${headerInner}`,
        "      </mj-column>",
        "    </mj-section>"
      ].join("\n")
    : "";

  // Footer is opt-in: only a sender-supplied copyright/note and/or an
  // unsubscribe link. No vendor branding is ever added by default.
  const footerLines = [
    brandName ? `&copy; ${safeBrand}` : null,
    branding.footerNote ? escapeHtml(branding.footerNote) : null
  ]
    .filter(Boolean)
    .join("<br />");

  const footerText = footerLines
    ? `<mj-text align="center" font-size="12px" color="#9aa5b1" line-height="1.5" padding="0">${footerLines}</mj-text>`
    : "";

  const unsubscribe = branding.unsubscribeUrl
    ? `<mj-text align="center" font-size="12px" color="#9aa5b1" padding="8px 0 0">` +
      `<a href="${branding.unsubscribeUrl}" style="color:#9aa5b1;text-decoration:underline;">Unsubscribe</a>` +
      `</mj-text>`
    : "";

  const footer =
    footerText || unsubscribe
      ? [
          `    <mj-section padding="16px 0 28px">`,
          "      <mj-column>",
          `        ${footerText}`,
          `        ${unsubscribe}`,
          "      </mj-column>",
          "    </mj-section>"
        ].join("\n")
      : "";

  // Body padding adapts so the content isn't crammed against the top/bottom
  // when there's no header/footer section to provide breathing room.
  const bodyPadding = header || footer ? "36px 40px" : "40px";

  return [
    "<mjml>",
    "  <mj-head>",
    "    <mj-attributes>",
    `      <mj-all font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" />`,
    `      <mj-text font-size="16px" color="#1f2933" line-height="1.65" />`,
    "    </mj-attributes>",
    "    <mj-style>",
    `      .qq-body h1 { font-size: 24px; line-height: 1.3; margin: 0 0 12px; color: #102a43; }`,
    `      .qq-body h2 { font-size: 20px; line-height: 1.35; margin: 20px 0 10px; color: #243b53; }`,
    `      .qq-body p { margin: 0 0 14px; }`,
    `      .qq-body a { color: ${accent}; }`,
    `      .qq-body ul, .qq-body ol { margin: 0 0 14px; padding-left: 22px; }`,
    `      .qq-body img { max-width: 100%; height: auto; }`,
    `      .qq-body blockquote { margin: 0 0 14px; padding: 4px 0 4px 16px; border-left: 3px solid ${accent}; color: #486581; }`,
    "    </mj-style>",
    "  </mj-head>",
    // No page tint and no card panel: the sender's content sits on the client's
    // default background. Chrome the sender didn't author doesn't get added.
    `  <mj-body>`,
    header,
    `    <mj-section padding="${bodyPadding}">`,
    "      <mj-column>",
    // mj-text, not mj-raw: mj-raw emits its markup as a direct child of <tbody>,
    // which parsers foster-parent out of the table and into the surrounding
    // column (font-size:0px) — the body arrives invisible. mj-text renders a
    // real <tr><td> and applies the mj-all/mj-text font attributes.
    `        <mj-text padding="0"><div class="qq-body">${bodyHtml}</div></mj-text>`,
    "      </mj-column>",
    "    </mj-section>",
    footer,
    "  </mj-body>",
    "</mjml>"
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Convenience: wrap body HTML in a branded MJML document and render it to
 * email-safe HTML. Falls back to the original body HTML if compilation fails.
 */
export async function renderHtmlAsEmailSafe(
  bodyHtml: string,
  options: RenderMjmlOptions & { branding?: EmailBranding } = {}
): Promise<RenderMjmlResult> {
  const { branding, ...mjmlOptions } = options;
  return renderMjml(wrapHtmlInMjml(bodyHtml, branding), {
    fallbackHtml: bodyHtml,
    ...mjmlOptions
  });
}
