import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.js";

interface InboundHtmlFrameProps {
  /** Raw HTML body as received over IMAP. Untrusted. */
  html: string;
  /** Whether remote (http/https) images are permitted to load. */
  showRemoteContent: boolean;
  /**
   * Inline parts of this message, keyed by normalized Content-ID, each pointing
   * at a local `blob:` URL. Body `cid:` references are rewritten to these.
   */
  inlineImages?: Record<string, string>;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

/** Content-IDs travel wrapped in angle brackets in MIME but bare in `cid:` URLs. */
export function normalizeContentId(value: string) {
  return value.trim().replace(/^<+/, "").replace(/>+$/, "").toLowerCase();
}

/**
 * Prepare a received body for display: point `cid:` images at the inline part
 * we already downloaded, and strip the `src` of remote images while they are
 * blocked. Without that strip the reader sees a page of broken-image icons —
 * CSP refuses the request, but the empty <img> still renders as a failure.
 *
 * Parsed with DOMParser (an inert document: no scripts run, no subresources
 * load) rather than by regex, so hostile markup can't be mangled into
 * something that means one thing here and another in the iframe.
 */
function prepareBody(
  html: string,
  options: { showRemoteContent: boolean; inlineImages: Record<string, string> }
) {
  // Nothing to rewrite in an image-less body, and re-serializing costs fidelity
  // (the parser normalizes markup), so leave those messages exactly as sent.
  if (!/<img/i.test(html) && !html.includes("cid:")) {
    return html;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (/^cid:/i.test(src)) {
      const resolved = options.inlineImages[normalizeContentId(src.slice(4))];
      // An unresolvable part (never stored, or the fetch failed) is dropped
      // rather than left to fail loudly.
      if (resolved) {
        img.setAttribute("src", resolved);
      } else {
        img.removeAttribute("src");
      }
      img.removeAttribute("srcset");
    } else if (!options.showRemoteContent && /^https?:/i.test(src)) {
      img.removeAttribute("src");
      img.removeAttribute("srcset");
    }
  }

  // A full-document body keeps its <head> styles, which the parser hoists out
  // of the fragment we serialize; carry them back in or the mail loses its CSS.
  const headStyles = Array.from(doc.head.querySelectorAll("style"))
    .map((node) => node.outerHTML)
    .join("");
  return headStyles + doc.body.innerHTML;
}

/**
 * Render *received* email HTML inside a sandboxed iframe.
 *
 * This is deliberately separate from EmailPreviewFrame. That component previews
 * HTML we generated ourselves (MJML output); this one renders whatever a
 * stranger emailed us, so it is hostile input and gets stricter treatment:
 *
 * - The body is nested inside our own document shell rather than passed through
 *   as-is. An inbound message may be a bare fragment or a full <html> document;
 *   nesting handles both (the parser drops a nested <html>/<body> and keeps the
 *   content), and it guarantees our <meta> CSP is the first thing parsed.
 * - A CSP of `default-src 'none'` blocks scripts, frames, objects and network
 *   fetches outright, independently of the sandbox attribute. Remote images are
 *   allowed only once the reader opts in — otherwise merely opening a message
 *   would fire the sender's tracking pixel and leak a read receipt. Inline
 *   (`cid:`) parts are exempt: they arrived with the message, so displaying
 *   them phones nobody home.
 * - `sandbox="allow-same-origin"` carries NO allow-scripts, so no script in the
 *   message can execute; that is what makes reading the document height for
 *   auto-sizing safe. Scripts are blocked twice over (sandbox + CSP).
 */
export function InboundHtmlFrame({
  html,
  showRemoteContent,
  inlineImages,
  className,
  title = "Message body",
  "data-testid": testId
}: InboundHtmlFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  const srcDoc = useMemo(() => {
    // `blob:` is always allowed: those URLs are inline parts of this very
    // message, already fetched over the authenticated download route, so
    // rendering them tells the sender nothing.
    const imgSrc = showRemoteContent
      ? "data: blob: https: http:"
      : "data: blob:";
    const csp = [
      "default-src 'none'",
      `img-src ${imgSrc}`,
      "style-src 'unsafe-inline'",
      "font-src data:"
    ].join("; ");

    return [
      "<!doctype html><html><head>",
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      "<style>",
      "html,body{margin:0;padding:0;}",
      "body{font:14px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;word-break:break-word;}",
      // Received mail leans on presentational table markup; give it sane
      // defaults so a bare <table> is legible instead of running together.
      "table{border-collapse:collapse;max-width:100%;}",
      "th,td{padding:6px 10px;vertical-align:top;}",
      "img{max-width:100%;height:auto;}",
      "blockquote{margin:0 0 0 12px;padding-left:12px;border-left:3px solid #d4d4d8;color:#52525b;}",
      "a{color:#2563eb;}",
      "pre{white-space:pre-wrap;word-break:break-word;}",
      "</style></head><body>",
      prepareBody(html, {
        showRemoteContent,
        inlineImages: inlineImages ?? {}
      }),
      "</body></html>"
    ].join("");
  }, [html, showRemoteContent, inlineImages]);

  const resize = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc?.body) {
      const next = Math.max(
        doc.documentElement.scrollHeight,
        doc.body.scrollHeight
      );
      if (next > 0) {
        setHeight(next);
      }
    }
  }, []);

  // srcDoc swaps fire `load`, but images settle later; nudge once more.
  useEffect(() => {
    const id = window.setTimeout(resize, 50);
    return () => window.clearTimeout(id);
  }, [srcDoc, resize]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      data-testid={testId}
      onLoad={resize}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className={cn("w-full border-0 bg-transparent", className)}
      style={{ height }}
    />
  );
}
