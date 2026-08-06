import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { Hint } from "./tooltip.js";

const iconButtonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center rounded-control",
    "transition-colors duration-fast ease-out",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    /*
      Every size below is smaller than the 44px touch minimum, so the hit area
      is grown with an invisible pseudo-element instead of by drawing a bigger
      button. Desktop keeps the compact control; a thumb still gets 44px.
    */
    "after:absolute after:left-1/2 after:top-1/2 after:h-touch after:w-touch",
    "after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:hidden",
  ],
  {
    variants: {
      variant: {
        ghost: "text-text-secondary hover:bg-surface-sunken hover:text-text",
        outline:
          "border border-border-strong bg-surface text-text hover:bg-surface-sunken",
        solid: "bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive: "text-text-secondary hover:bg-err-bg hover:text-err",
      },
      size: {
        lg: "h-touch w-touch [&_svg]:size-5",
        md: "h-control w-control [&_svg]:size-4",
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
