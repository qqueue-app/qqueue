import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.js";

interface EmailPreviewFrameProps {
  /** Fully rendered, email-safe HTML (may be a complete <html> document). */
  html: string;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

/**
 * Render email HTML inside a sandboxed iframe.
 *
 * The send pipeline produces a complete, email-safe HTML document (MJML output
 * with its own <html>/<head>/<style>). Injecting that into the dashboard DOM via
 * dangerouslySetInnerHTML let the email's global styles leak into — and blank
 * out — the surrounding page. An iframe isolates the document entirely, so the
 * preview matches what recipients see without touching the app's styles.
 *
 * `sandbox="allow-same-origin"` (note: NO allow-scripts) keeps scripts from
 * executing while still letting us read the document height to size the frame.
 */
export function EmailPreviewFrame({
  html,
  className,
  title = "Email preview",
  "data-testid": testId
}: EmailPreviewFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);

  const resize = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc?.body) {
      const next = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      if (next > 0) {
        setHeight(next);
      }
    }
  }, []);

  // Re-measure when the HTML changes (srcDoc swaps fire `load`, but images can
  // settle later, so nudge once more on a microtask).
  useEffect(() => {
    const id = window.setTimeout(resize, 50);
    return () => window.clearTimeout(id);
  }, [html, resize]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      data-testid={testId}
      onLoad={resize}
      srcDoc={html}
      sandbox="allow-same-origin"
      className={cn("w-full rounded-md border bg-white", className)}
      style={{ height }}
    />
  );
}
