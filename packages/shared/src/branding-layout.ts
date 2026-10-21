export interface BrandingLayoutValues {
  brandName?: string | null;
  logoUrl?: string | null;
  accentColor?: string | null;
  footerNote?: string | null;
}

export const BRANDING_HTML_LIMIT = 100_000;
export const BRANDING_FOOTER_MARKER = "qq-branding-footer-note";

export function brandingLayoutError(html: string): string | null {
  if (html.length > BRANDING_HTML_LIMIT)
    return "Branding HTML must be 100,000 characters or fewer.";
  if ((html.match(/\{\{\s*content\s*\}\}/g) ?? []).length !== 1) {
    return "Include {{content}} exactly once, where the email's content should appear.";
  }
  return null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Substitute only the layout, so email content and merge tags stay untouched. */
export function renderBrandingLayout(
  html: string,
  content: string,
  values: BrandingLayoutValues
): string {
  const replacements: Record<string, string> = {
    content,
    brand_name: escapeHtml(values.brandName ?? ""),
    logo_url: escapeHtml(values.logoUrl ?? ""),
    accent_color: /^#[0-9a-fA-F]{6}$/.test(values.accentColor ?? "")
      ? values.accentColor!
      : "#2E7D63",
    footer_note: values.footerNote?.trim()
      ? `<div class="${BRANDING_FOOTER_MARKER}">${escapeHtml(values.footerNote).replace(/\r?\n/g, "<br />")}</div>`
      : ""
  };
  return html.replace(
    /\{\{\s*(content|brand_name|logo_url|accent_color|footer_note)\s*\}\}/g,
    (_match, key: string) => replacements[key]!
  );
}

export const BRANDING_STARTERS = [
  {
    id: "classic",
    name: "Current branding",
    description: "Your existing identity in a simple, centred email layout."
  },
  {
    id: "accent",
    name: "Accent header",
    description: "A colour bar and left-aligned identity for announcements."
  },
  {
    id: "card",
    name: "Card",
    description: "A white content panel on a soft background for newsletters."
  }
] as const;
export type BrandingStarter = (typeof BRANDING_STARTERS)[number]["id"];

/** Identity values remain placeholders, so changing a colour or logo still works. */
export function createBrandingLayout(
  values: BrandingLayoutValues,
  starter: BrandingStarter = "classic"
): string {
  const align = starter === "accent" ? "left" : "center";
  const header = values.logoUrl
    ? '<img src="{{logo_url}}" alt="{{brand_name}}" width="160" style="max-width:160px;height:auto;border:0;" />'
    : '<p style="font-size:22px;color:{{accent_color}};"><strong>{{brand_name}}</strong></p>';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<style>.qq-content a { color: {{accent_color}}; } .qq-content img { max-width:100%;height:auto; }</style></head>
<body style="margin:0;padding:24px 0;background:${starter === "card" ? "#f0f4f8" : "#ffffff"};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;${starter === "accent" ? "border-top:6px solid {{accent_color}};" : ""}">
<tr><td style="padding:28px 40px 12px;text-align:${align};">${header}</td></tr>
<tr><td class="qq-content" style="padding:36px 40px;font-size:16px;line-height:1.65;color:#1f2933;">{{content}}</td></tr>
<tr><td style="padding:16px 40px 28px;text-align:${align};font-size:12px;line-height:1.5;color:#9aa5b1;">${values.brandName ? "<p>&copy; {{brand_name}}</p>" : ""}{{footer_note}}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
