import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

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
 * A container is not a measure. Content narrower than the container — a 640px
 * form, the composer's 976px cluster — still needs `mx-auto`, or it hugs the
 * container's left edge and nothing has been fixed.
 */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("container py-4 sm:py-6", className)}>{children}</div>
  );
}
