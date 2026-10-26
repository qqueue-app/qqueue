import { useMemo, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { createBrandingLayout, renderBrandingLayout } from "@qqueue/shared";
import { cn } from "@/lib/utils";
import type { OrganizationBranding, TemplateVariable } from "@/lib/api";
import { applyVariables, resolveVariableData } from "./variables";
import { isFullHtmlDocument } from "./html-source";

interface TemplatePreviewProps {
  subject: string;
  html: string;
  variables?: TemplateVariable[] | null;
  sampleData?: Record<string, string>;
  branding?: OrganizationBranding | null;
}

export function TemplatePreview({
  subject,
  html,
  variables,
  sampleData,
  branding
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
  const srcDoc = useMemo(() => {
    const body = applyVariables(html, data);
    if (
      isFullHtmlDocument(body) ||
      !branding?.brandingEnabled ||
      (!branding.layoutHtml &&
        !branding.brandName &&
        !branding.logoUrl &&
        !branding.accentColor &&
        !branding.footerNote)
    ) {
      return body;
    }
    return renderBrandingLayout(
      branding.layoutHtml ?? createBrandingLayout(branding),
      body,
      branding
    );
  }, [html, data, branding]);

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
