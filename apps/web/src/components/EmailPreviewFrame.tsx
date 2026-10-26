import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.js";

interface EmailPreviewFrameProps {
  /** Authored HTML (may be a complete <html> document). */
  html: string;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

/**
 * Preview authored email HTML inside a sandboxed iframe.
 *
 * An iframe isolates email styles from the dashboard. The iframe receives the
 * authored HTML without adding a layout or changing the send payload.
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
      className={cn("w-full rounded-control border bg-email-paper", className)}
      style={{ height }}
    />
  );
}
