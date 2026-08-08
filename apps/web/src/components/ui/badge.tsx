import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status badge — tinted background with dark text, never a solid saturated pill.
 *
 * Each variant pairs a `*-bg` token with its matching `*-text` token, so the
 * contrast is decided once in the token file rather than by picking an opacity
 * at each call site.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill px-2 py-1 text-meta font-medium [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "bg-surface-sunken text-text-secondary",
        accent: "bg-accent text-accent-foreground",
        ok: "bg-ok-bg text-ok",
        warn: "bg-warn-bg text-warn",
        err: "bg-err-bg text-err",
        info: "bg-info-bg text-info",
        outline: "border border-border-strong text-text-secondary",

        // ---- Back-compat aliases (pre-migration call sites) ----
        default: "bg-accent text-accent-foreground",
        secondary: "bg-surface-sunken text-text-secondary",
        success: "bg-ok-bg text-ok",
        warning: "bg-warn-bg text-warn",
        destructive: "bg-err-bg text-err"
      }
    },
    defaultVariants: {
      variant: "neutral"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * forwardRef because badges are routinely wrapped in a tooltip trigger, which
 * needs a ref to position against. Without it Radix warns and the tooltip
 * anchors to the wrong place.
 */
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
