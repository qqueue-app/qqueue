import {
  brandingLayoutError,
  createBrandingLayout,
  renderBrandingLayout,
} from "@qqueue/shared";
import type { EmailBranding } from "./mjml.js";
import { isFullHtmlDocument } from "./mjml.js";

/** Apply the sender's saved branding without the default MJML body wrapper. */
export function applyEmailBranding(
  html: string | null | undefined,
  branding: EmailBranding | null | undefined,
): string | undefined {
  if (!html || !branding?.brandingEnabled || isFullHtmlDocument(html)) {
    return html ?? undefined;
  }

  if (
    !branding.layoutHtml &&
    !branding.brandName &&
    !branding.logoUrl &&
    !branding.accentColor &&
    !branding.footerNote
  ) {
    return html;
  }

  const layout = branding.layoutHtml ?? createBrandingLayout(branding);
  if (brandingLayoutError(layout)) return html;
  return renderBrandingLayout(layout, html, branding);
}
