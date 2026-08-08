import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateVariable } from "@/lib/api";
import { isFullHtmlDocument } from "./html-source";
import { applyVariables, resolveVariableData } from "./variables";
import { EMAIL_ACCENT, EMAIL_NEUTRALS } from "../../lib/email-palette.js";

interface TemplatePreviewProps {
  subject: string;
  html: string;
  variables?: TemplateVariable[] | null;
  sampleData?: Record<string, string>;
}

// Minimal email-like document shell for the preview iframe. Sandboxed with no
// allowances, so template HTML can never run scripts or navigate the parent.
function buildDocument(bodyHtml: string) {
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { margin: 0; padding: 24px; background: ${EMAIL_NEUTRALS.backdrop};
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: ${EMAIL_NEUTRALS.text}; line-height: 1.6; }
  .qq-card { max-width: 600px; margin: 0 auto; background: ${EMAIL_NEUTRALS.paper};
    border-radius: 12px; padding: 32px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.04); }
  .qq-card img { max-width: 100%; height: auto; }
  .qq-card a { color: ${EMAIL_ACCENT}; }
  .qq-card h1 { font-size: 24px; line-height: 1.3; margin: 0 0 12px; }
  .qq-card h2 { font-size: 20px; line-height: 1.35; margin: 20px 0 10px; }
  .qq-card p { margin: 0 0 14px; }
  .qq-card hr { border: none; border-top: 1px solid ${EMAIL_NEUTRALS.border}; margin: 20px 0; }
  .qq-card blockquote { margin: 0 0 14px; padding: 4px 0 4px 16px;
    border-left: 3px solid ${EMAIL_ACCENT}; color: ${EMAIL_NEUTRALS.textMuted}; }
</style></head>
<body><div class="qq-card">${bodyHtml}</div></body></html>`;
}

export function TemplatePreview({
  subject,
  html,
  variables,
  sampleData
}: TemplatePreviewProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const data = useMemo(
    () => resolveVariableData(variables, sampleData),
    [variables, sampleData]
  );
  const renderedSubject = useMemo(
    () => applyVariables(subject, data) || "(no subject)",
    [subject, data]
  );
  // A pasted full document already has its own head, styles, and page
  // background. Nesting it in the card shell would double the <html> element and
  // let the shell's body/card styles override the author's, so the preview would
  // stop matching what actually gets delivered — render it as its own document.
  const srcDoc = useMemo(() => {
    const applied = applyVariables(html, data);
    return isFullHtmlDocument(applied) ? applied : buildDocument(applied);
  }, [html, data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="min-w-0">
          <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
            Subject
          </p>
          <p className="truncate text-body font-medium" title={renderedSubject}>
            {renderedSubject}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1 rounded-control border bg-muted/40 p-1">
          <button
            type="button"
            aria-label="Desktop preview"
            title="Desktop"
            onClick={() => setDevice("desktop")}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-4",
              device === "desktop" && "bg-background text-foreground shadow-sm"
            )}
          >
            <Monitor />
          </button>
          <button
            type="button"
            aria-label="Mobile preview"
            title="Mobile"
            onClick={() => setDevice("mobile")}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-4",
              device === "mobile" && "bg-background text-foreground shadow-sm"
            )}
          >
            <Smartphone />
          </button>
        </div>
      </div>
      {/* `overflow-hidden`, not `auto`: the iframe is its own document and does
          its own scrolling, so a scroll region out here would be a second
          scrollbar for the same content (§2). */}
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-muted/30 p-4">
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={srcDoc}
          className={cn(
            "h-full rounded-card border bg-email-paper shadow-sm transition-all",
            device === "mobile" ? "w-phone" : "w-full max-w-email"
          )}
        />
      </div>
    </div>
  );
}
