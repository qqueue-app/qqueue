import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

/**
 * The container class every page in the shell wears, and the measure its
 * content sits on. Exported so `<PageHeader>` can wear the same one: the header
 * puts a full-bleed rule between the two, so it cannot simply nest inside a
 * `<PageContainer>`, and a second hand-written copy of the measure is exactly
 * how the title drifted off the content's edge the first time.
 */
export const pageContainer = "container";
export const pageMeasure = "mx-auto max-w-page";

/**
 * The page: one centred column, the same width on every screen in the app.
 *
 * Two things were wrong before this. Content was capped but never centred, so
 * on a wide window it pinned left and every spare pixel piled up on the right —
 * 656px of it on the composer at 1920px. And the cap itself differed per page:
 * 640px on Settings, 1120px on Insights, 1200px on Contacts, none at all on
 * Suppressions. Each was defensible alone; together they meant the left edge of
 * the app moved as you navigated, which is how nobody uses one page at a time.
 *
 * Horizontal padding and the 1400px ceiling come from Tailwind's `container`
 * (configured in `tailwind.config.ts`), so **a page adopting this drops its own
 * `px-4 sm:px-6`** or the two stack up.
 *
 * Content inside keeps its own measures — a field still stops at 480px, prose
 * at `max-w-read`. A page is not the width of its widest input; it is the width
 * of its section rules and its rows, and those are what were being squeezed.
 *
 * The Inbox is deliberately not in here: it is a full-height two-pane mail view
 * and gutters around a split pane would break the thing it is imitating.
 */
export function PageContainer({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(pageContainer, "py-4 sm:py-6")}>
      <div className={cn(pageMeasure, className)}>{children}</div>
    </div>
  );
}
