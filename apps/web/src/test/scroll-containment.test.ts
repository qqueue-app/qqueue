import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

/**
 * Classes that can produce a *vertical* scroll container. `overflow-x-*` is
 * excluded on purpose: §2's rule is about the page's scroll, and a wide data
 * table scrolling sideways at desktop is explicitly allowed ("tables may go
 * wide; forms never do").
 */
const VERTICAL_SCROLLERS =
  /\b(overflow-auto|overflow-scroll|overflow-y-auto|overflow-y-scroll)\b/;

/** Overlay components whose content is one of §2's named exceptions. */
const OVERLAY_CONTENT = /<(Dialog|Sheet|Popover|DropdownMenu|AlertDialog)Content/;

/**
 * An explicit, reasoned opt-out. Written directly above the line it excuses:
 *
 *   // scroll-exception: the combobox listbox — §2 allows these.
 *
 * A marker with no reason after the colon does not count.
 */
const EXCEPTION_MARKER = /scroll-exception:\s*\S+/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx$/.test(entry) || /\.test\.tsx$/.test(entry)) return [];
    return [full];
  });
}

/** Line indices that sit inside a comment, so prose about the rule isn't a breach of it. */
function commentLines(lines: string[]): Set<number> {
  const inside = new Set<number>();
  let block = false;
  lines.forEach((line, index) => {
    const opens = line.includes("/*");
    const closes = line.includes("*/");
    if (block || opens) inside.add(index);
    if (opens && !closes) block = true;
    else if (closes) block = false;
    if (/^\s*\/\//.test(line)) inside.add(index);
  });
  return inside;
}

/**
 * Nearest enclosing overlay for a line, found by walking upward to either an
 * overlay's `Content` element or the top of the enclosing function.
 */
function enclosingOverlay(lines: string[], index: number): string | null {
  for (let i = index; i >= 0; i -= 1) {
    const overlay = OVERLAY_CONTENT.exec(lines[i]);
    if (overlay) return overlay[1];
    if (/^\s*(export )?(function|const) \w+/.test(lines[i])) return null;
  }
  return null;
}

/*
  §2 gives the app exactly one scroll container — the document — and names its
  only exceptions: dropdown menus, comboboxes and dialogs. Every one of those is
  an overlay that freezes the page behind it, so even then only one scrollbar is
  ever on screen.

  This is a lint, not a render test: jsdom has no layout engine, so the honest
  way to hold the invariant is to check that nobody declared a scroll region in
  the first place. When this fails, the fix is almost never to reach for the
  exception marker — it is that the content belongs on its own page.
*/
describe("scroll containment (§2)", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    const comments = commentLines(lines);

    lines.forEach((line, index) => {
      if (!VERTICAL_SCROLLERS.test(line)) return;
      if (comments.has(index)) return;
      if (enclosingOverlay(lines, index)) return;
      // An opt-out has to be stated within the three lines above the offence.
      const preamble = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
      if (EXCEPTION_MARKER.test(preamble)) return;
      offenders.push(`${relative(SRC, file).replace(/\\/g, "/")}:${index + 1}`);
    });
  }

  it("declares no vertical scroll container outside an overlay", () => {
    expect(offenders).toEqual([]);
  });

  it("keeps the shell itself free of any overflow declaration", () => {
    const shellFiles = [
      "layouts/DashboardLayout.tsx",
      "components/shell/SidebarNav.tsx",
      "components/shell/MobileTabBar.tsx",
      "components/shell/MoreSheet.tsx",
    ];

    for (const relPath of shellFiles) {
      const lines = readFileSync(join(SRC, relPath), "utf8").split("\n");
      const comments = commentLines(lines);
      const declarations = lines.filter(
        (line, index) => !comments.has(index) && /\boverflow-/.test(line)
      );
      expect(declarations, `${relPath} must not manage its own overflow`).toEqual(
        []
      );
    }
  });
});
