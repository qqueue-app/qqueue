import { expect, it } from "vitest";
import {
  BRANDING_STARTERS,
  createBrandingLayout,
  renderBrandingLayout
} from "@qqueue/shared";
import { toEditorHtml } from "./document-model";

it.each(BRANDING_STARTERS)(
  "keeps the $name starter visually editable",
  (starter) => {
    for (const logoUrl of [null, "https://example.com/logo.png"]) {
      const identity = {
        brandName: "Acme",
        logoUrl,
        footerNote: "Address",
        accentColor: "#123456"
      };
      const visual = renderBrandingLayout(
        createBrandingLayout(identity, starter.id),
        "{{content}}",
        identity
      );
      const prepared = toEditorHtml(visual);
      expect(prepared.frozen).toBe(0);
      expect(prepared.html).toContain("Acme");
      expect(prepared.html).toContain("Address");
    }
  }
);
