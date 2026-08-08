import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";

/**
 * The 640px form column every settings subpage lives in (§2).
 *
 * Left-aligned rather than centred: the sidebar already anchors the page to the
 * left, and a column that drifts to the middle of a 1920px window puts the
 * content somewhere different on every screen.
 *
 * The padding is the mobile inversion's other half. Fields inside collapse to
 * 100% below 480px (see `fieldWidths`), and 100% has to mean "the padded
 * column", not "the viewport" — which is why the 16px lives here, once, rather
 * than on each field.
 */
export function FormColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-form px-4 py-4 sm:px-6 sm:py-6", className)}>
      {children}
    </div>
  );
}

/**
 * A group of related fields under a 16px/600 title.
 *
 * Groups are separated by space, not by borders or nested cards — §3. A card
 * around every group is what turned the old settings page into a wall of boxes
 * with nothing to say about which of them mattered.
 */
export function FormSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** A control that belongs to the group's heading rather than to a field. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-section font-semibold text-text">{title}</h2>
          {description ? (
            <p className="mt-1 text-ui leading-5 text-text-secondary">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The 32px gap between form sections, as a container so no page has to
 * remember the number.
 */
export function FormSections({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-8", className)}>{children}</div>;
}

/**
 * Label → 6px → field → 6px → helper, the vertical rhythm from §3.
 *
 * Wrapping it means a page can't accidentally ship `space-y-2` in one place and
 * `space-y-3` in the next, which is the whole reason forms drift.
 */
export function Field({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-field", className)}>{children}</div>;
}
