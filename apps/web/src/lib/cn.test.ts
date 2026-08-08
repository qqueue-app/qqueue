import { describe, expect, it } from "vitest";
import config from "../../tailwind.config.js";
import { cn, FONT_SIZE_NAMES, FONT_WEIGHT_NAMES } from "./utils.js";

/*
  `cn` is tailwind-merge, and tailwind-merge only knows Tailwind's *stock*
  scales. This design system renamed the type scale to roles — `text-body`,
  `text-meta` — which look exactly like colour names to it. Left unconfigured
  it files them as colours, and a class that shares a group is deleted rather
  than merged. Nothing warns; the class simply is not in the output.

  These tests pin the two halves of the fix: that the names `cn` was taught
  still match the theme, and that a size and a colour can coexist.
*/
describe("cn", () => {
  const theme = (config.theme?.extend ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;

  it("knows every font size the theme defines", () => {
    expect([...FONT_SIZE_NAMES].sort()).toEqual(
      Object.keys(theme.fontSize ?? {}).sort()
    );
  });

  it("knows every font weight the theme defines", () => {
    expect([...FONT_WEIGHT_NAMES].sort()).toEqual(
      Object.keys(theme.fontWeight ?? {}).sort()
    );
  });

  it("keeps a text colour and a text size together", () => {
    const out = cn("text-primary-foreground", "text-body").split(" ");
    expect(out).toContain("text-primary-foreground");
    expect(out).toContain("text-body");
  });

  // The regression that started this: a primary button is the accent green
  // with white on it, and `cva` puts the size after the variant.
  it("leaves the primary button's label white", () => {
    const out = cn(
      "bg-primary text-primary-foreground hover:bg-primary-hover",
      "h-control px-4 text-body"
    ).split(" ");
    expect(out).toContain("text-primary-foreground");
  });

  // And the same failure in the other direction: a badge's variant colour came
  // last and deleted its size.
  it("leaves a badge at its own 12px size", () => {
    const out = cn("text-meta font-medium", "bg-ok-bg text-ok").split(" ");
    expect(out).toContain("text-meta");
    expect(out).toContain("text-ok");
  });

  it("still collapses two sizes, and two colours, to the last one", () => {
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("text-err", "text-ok")).toBe("text-ok");
    expect(cn("font-medium", "font-semibold")).toBe("font-semibold");
  });

  it("still lets a caller override a component's colour", () => {
    const out = cn("text-text-secondary text-body", "text-err").split(" ");
    expect(out).toContain("text-err");
    expect(out).not.toContain("text-text-secondary");
    expect(out).toContain("text-body");
  });
});
