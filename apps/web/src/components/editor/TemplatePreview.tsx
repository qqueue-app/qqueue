import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateVariable } from "@/lib/api";
import { applyVariables, resolveVariableData } from "./variables";

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
  body { margin: 0; padding: 24px; background: #f4f5f7;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1f2933; line-height: 1.6; }
  .qq-card { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px;
    padding: 32px; box-shadow: 0 1px 3px rgba(16,42,67,.08); }
  .qq-card img { max-width: 100%; height: auto; }
  .qq-card a { color: #2e7d63; }
  .qq-card h1 { font-size: 24px; line-height: 1.3; margin: 0 0 12px; }
  .qq-card h2 { font-size: 20px; line-height: 1.35; margin: 20px 0 10px; }
  .qq-card p { margin: 0 0 14px; }
  .qq-card hr { border: none; border-top: 1px solid #e4e7eb; margin: 20px 0; }
  .qq-card blockquote { margin: 0 0 14px; padding: 4px 0 4px 16px;
    border-left: 3px solid #2e7d63; color: #486581; }
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
  const srcDoc = useMemo(
    () => buildDocument(applyVariables(html, data)),
    [html, data]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Subject
          </p>
          <p className="truncate text-sm font-medium" title={renderedSubject}>
            {renderedSubject}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1 rounded-md border bg-muted/40 p-0.5">
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
      <div className="flex flex-1 justify-center overflow-auto bg-muted/30 p-4">
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={srcDoc}
          className={cn(
            "h-full rounded-lg border bg-white shadow-sm transition-all",
            device === "mobile" ? "w-[375px]" : "w-full max-w-[680px]"
          )}
        />
      </div>
    </div>
  );
}
