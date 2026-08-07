import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design system's type scale (§1), named by role rather than by measure.
 *
 * tailwind-merge has to be told these names, and the reason is worth stating
 * because the failure is silent. It sorts a `text-*` class into either the
 * font-size group or the text-colour group by looking at the value — `text-sm`
 * is a size, `text-red-500` is a colour. Every name below looks like a colour
 * to it, so `text-body` and `text-primary-foreground` land in the *same* group
 * and the later one deletes the earlier.
 *
 * `cva` emits variants before sizes, so the size always came last and always
 * won: every Button variant lost its text colour, which is how the primary
 * button ended up rendering near-black text on the accent green. Badges failed
 * the other way round — the variant colour came last and deleted `text-meta`,
 * so they inherited whatever size their container had.
 *
 * Keep in sync with `fontSize` in tailwind.config.ts; `cn.test.ts` fails if
 * they drift apart.
 */
export const FONT_SIZE_NAMES = [
  "meta",
  "ui",
  "body",
  "section",
  "title",
  "stat",
] as const;

/**
 * The weight scale, for the same reason: `text` is not a weight tailwind-merge
 * recognises, so `font-text` would be filed under font-*family* and would fail
 * to collapse against `font-medium`.
 */
export const FONT_WEIGHT_NAMES = ["text", "medium", "semibold"] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZE_NAMES] }],
      "font-weight": [{ font: [...FONT_WEIGHT_NAMES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
