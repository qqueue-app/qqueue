import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { Hint } from "./tooltip.js";

const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        outline:
          "border border-input bg-card text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground",
        solid:
          "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90",
        destructive:
          "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
      },
      size: {
        // 44px — the minimum comfortable touch target on mobile.
        lg: "h-11 w-11 [&_svg]:size-5",
        md: "h-9 w-9 [&_svg]:size-4",
        sm: "h-8 w-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
);

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">,
    VariantProps<typeof iconButtonVariants> {
  /**
   * What the action does, in plain words. Rendered as a tooltip *and* as the
   * accessible name — this prop is required precisely so an icon-only control
   * can never ship unlabelled.
   */
  label: string;
  /** Optional keyboard shortcut shown in the tooltip. */
  shortcut?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Suppress the tooltip only where one already wraps the button (e.g. a menu trigger inside a Hint). */
  hideTooltip?: boolean;
  asChild?: boolean;
}

/**
 * An icon-only button. Every instance carries a tooltip and an `aria-label`
 * derived from the same `label`, so the two can never drift apart.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      shortcut,
      tooltipSide = "top",
      hideTooltip = false,
      variant,
      size,
      className,
      asChild = false,
      type = "button",
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const button = (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        aria-label={label}
        className={cn(iconButtonVariants({ variant, size }), className)}
        {...props}
      />
    );

    if (hideTooltip) {
      return button;
    }

    return (
      <Hint label={label} shortcut={shortcut} side={tooltipSide}>
        {button}
      </Hint>
    );
  }
);
IconButton.displayName = "IconButton";

export { iconButtonVariants };
