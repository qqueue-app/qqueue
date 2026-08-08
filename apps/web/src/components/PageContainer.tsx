import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

/**
 * How wide a page's content runs, and therefore where its header's text has to
 * start. One name covers both so they cannot drift: `<PageHeader>` and
 * `<PageContainer>` take the same value and resolve it through `pageWidth`,
 * which is what makes the title line up with the form beneath it.
 *
 * - `full` — no container at all, `px-6` flush left. The unconverted default.
 * - `page` — fills the container; for content that wants every pixel of it.
 * - `form` / `table` — the §2 measures, centred.
 * - `compose` — 640px stacked, widening to the composer's form+rail cluster
 *   once the rail moves alongside at `xl`.
 */
export type PageWidth = "full" | "page" | "form" | "table" | "compose";

const measures: Record<PageWidth, string> = {
  full: "",
  page: "",
  form: "mx-auto max-w-form",
  table: "mx-auto max-w-table",
  compose: "mx-auto max-w-form xl:max-w-compose"
};

/**
 * The two class strings a page width resolves to: the container that supplies
 * the horizontal padding and the 1400px cap, and the measure that centres
 * content inside it.
 *
 * They are separate because they sit on different elements — a header puts a
 * full-bleed rule between them — and returning both from one place is what
 * stops a page from containing its content but not its title.
 */
export function pageWidth(width: PageWidth): {
  container: string;
  measure: string;
} {
  return {
    container: width === "full" ? "px-6" : "container",
    measure: measures[width]
  };
}

/**
 * The page container: one centred, capped column that a page's header and its
 * content both sit in.
 *
 * Before this, every page reached for a bare `max-w-*` with no `mx-auto`, so
 * content pinned to the left and all the slack on a wide screen piled up on the
 * right — 656px of it on the composer at 1920px. Capping a width says how wide
 * content may be; it does not say where the leftover goes, and "all of it to
 * the right" is what read as lopsided.
 *
 * Horizontal padding and the max-width ladder come from Tailwind's `container`
 * (configured in `tailwind.config.ts`), so **a page adopting this drops its own
 * `px-4 sm:px-6`** or the two stack up. Only the vertical rhythm is added here.
 *
 * A container is not a measure: content narrower than the container still needs
 * centring, which is what `width` supplies. Pass the same `width` to this
 * page's `<PageHeader>`.
 */
export function PageContainer({
  children,
  width = "page",
  className
}: {
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}) {
  const { container, measure } = pageWidth(width);
  return (
    <div className={cn(container, "py-4 sm:py-6")}>
      <div className={cn(measure, className)}>{children}</div>
    </div>
  );
}
