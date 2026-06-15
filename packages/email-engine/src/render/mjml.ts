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
 * Wrap arbitrary body HTML (e.g. editor/template output) in a minimal MJML
 * document. The MJML scaffold provides the email-safe table/column structure;
 * the body is passed through verbatim via `<mj-raw>`.
 */
export function wrapHtmlInMjml(bodyHtml: string): string {
  return [
    "<mjml>",
    "  <mj-body>",
    "    <mj-section>",
    "      <mj-column>",
    `        <mj-raw>${bodyHtml}</mj-raw>`,
    "      </mj-column>",
    "    </mj-section>",
    "  </mj-body>",
    "</mjml>"
  ].join("\n");
}

/**
 * Convenience: wrap body HTML in an MJML document and render it to email-safe
 * HTML. Falls back to the original body HTML if compilation fails.
 */
export async function renderHtmlAsEmailSafe(
  bodyHtml: string,
  options: RenderMjmlOptions = {}
): Promise<RenderMjmlResult> {
  return renderMjml(wrapHtmlInMjml(bodyHtml), {
    fallbackHtml: bodyHtml,
    ...options
  });
}
