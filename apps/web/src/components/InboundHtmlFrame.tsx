import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils.js";

interface InboundHtmlFrameProps {
  /** Raw HTML body as received over IMAP. Untrusted. */
  html: string;
  /** Whether remote (http/https) images are permitted to load. */
  showRemoteContent: boolean;
  className?: string;
  title?: string;
  "data-testid"?: string;
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
 *   would fire the sender's tracking pixel and leak a read receipt.
 * - `sandbox="allow-same-origin"` carries NO allow-scripts, so no script in the
 *   message can execute; that is what makes reading the document height for
 *   auto-sizing safe. Scripts are blocked twice over (sandbox + CSP).
 */
export function InboundHtmlFrame({
  html,
  showRemoteContent,
  className,
  title = "Message body",
  "data-testid": testId
}: InboundHtmlFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  const srcDoc = useMemo(() => {
    // `cid:` parts are never resolvable (inbound attachments aren't stored), so
    // inline-referenced images simply fail to load rather than hitting network.
    const imgSrc = showRemoteContent ? "data: https: http:" : "data:";
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
      html,
      "</body></html>"
    ].join("");
  }, [html, showRemoteContent]);

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
