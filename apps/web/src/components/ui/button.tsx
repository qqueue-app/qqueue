import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button.
 *
 * Three real variants, in descending loudness:
 *
 *   primary    accent background, white text. ONE per view — the main action
 *              ("Send email", "Save changes"). A second one competes with it
 *              and the view stops having an obvious next step.
 *   secondary  surface background, strong border. Everything else.
 *   ghost      text only. Minor and destructive-adjacent actions.
 *
 * `destructive` is a ghost that names its consequence in --err-text; a delete
 * button that shouts in solid red draws the eye to the one thing nobody should
 * click by accident.
 *
 * Labels are verbs that name the outcome — "Create key", "Invite teammate" —
 * never "Submit" or "OK".
 *
 * `default` and `outline` are aliases kept so the 64 existing call sites keep
 * compiling while pages migrate; they are not part of the design vocabulary.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-control font-medium",
    "transition-colors duration-fast ease-out",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    /*
      Touch slop. The button keeps its 36px visual height on desktop, but below
      the tablet breakpoint the tappable area grows to 44px via an invisible
      pseudo-element rather than by making the control bigger — the system asks
      for both, and padding alone cannot deliver them at once.
    */
    "relative after:absolute after:inset-x-0 after:top-1/2 after:h-touch",
    "after:-translate-y-1/2 after:content-[''] sm:after:hidden"
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "border border-border-strong bg-surface text-text hover:bg-surface-sunken",
        ghost: "text-text-secondary hover:bg-surface-sunken hover:text-text",
        destructive: "text-err hover:bg-err-bg",
        link: "text-primary underline-offset-4 hover:underline",

        // ---- Back-compat aliases (pre-migration call sites) ----
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "border border-border-strong bg-surface text-text hover:bg-surface-sunken"
      },
      size: {
        // 36px is the system height. `sm` exists for dense toolbars and table
        // rows; there is deliberately no `lg`.
        default: "h-control px-4 text-body",
        sm: "h-8 px-3 text-ui",
        icon: "h-control w-control"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/*
  Note: `type` is deliberately left to the native default. A <button> inside a
  <form> submits it, and 19 call sites depend on that — overriding it here would
  quietly turn "Send email" into a no-op.
*/
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
