import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../tailwind.config.js";

const SRC = join(__dirname, "..");

/**
 * Every `w-*` / `h-*` / `min-w-*` / `min-h-*` class the app actually writes,
 * including inside variants (`sm:`, `after:`, `md:hover:`), which is exactly
 * where a missing utility hides longest.
 */
function usedSizeUtilities(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;

      const source = readFileSync(full, "utf8");
      const pattern = /(?:^|[\s"'`])(?:[a-z-]+:)*((?:min-)?[wh])-([a-z][a-z0-9-]*)/g;
      for (const match of source.matchAll(pattern)) {
        const [, prefix, name] = match;
        if (!found.has(prefix)) found.set(prefix, new Set());
        found.get(prefix)!.add(name);
      }
    }
  }

  walk(SRC);
  return found;
}

/** Scale a `w-`/`h-`/`min-w-`/`min-h-` class resolves against. */
const SCALES: Record<string, string[]> = {
  w: ["width", "spacing"],
  h: ["height", "spacing"],
  "min-w": ["minWidth", "spacing"],
  "min-h": ["minHeight", "spacing"],
};

/** Names Tailwind provides out of the box for these scales. */
const BUILT_IN = new Set([
  "auto", "full", "screen", "min", "max", "fit", "px", "svh", "lvh", "dvh",
  "svw", "lvw", "dvw", "prose",
]);

/*
  A design token that is declared in CSS but never wired into the Tailwind
  theme compiles to *nothing*, and nothing is invisible: `w-control` looked
  right in every source file and in every class-name assertion, while the
  button it sized had no width at all. This test is the check that a class name
  someone wrote resolves to a real utility.
*/
describe("theme utilities exist for the classes the app writes", () => {
  const theme = (config.theme?.extend ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;

  it.each(Object.keys(SCALES))("resolves every %s-* class in use", (prefix) => {
    const used = usedSizeUtilities().get(prefix) ?? new Set<string>();
    const scales = SCALES[prefix];

    const missing = [...used].filter((name) => {
      if (BUILT_IN.has(name)) return false;
      // Tailwind's own numeric/fraction steps (w-4, h-1/2, w-0.5).
      if (/^\d/.test(name)) return false;
      return !scales.some((scale) => theme[scale] && name in theme[scale]!);
    });

    expect(missing, `${prefix}-* classes with no theme entry`).toEqual([]);
  });

  // The specific pair that was missing, named so the regression can't come
  // back quietly: square controls need a width as well as a height.
  it("sizes square controls in both dimensions", () => {
    for (const name of ["control", "touch"]) {
      expect(theme.width?.[name], `width.${name}`).toBeDefined();
      expect(theme.height?.[name], `height.${name}`).toBeDefined();
      expect(theme.width?.[name]).toBe(theme.height?.[name]);
    }
  });
});
