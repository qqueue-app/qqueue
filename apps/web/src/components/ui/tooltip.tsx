import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipPortal = TooltipPrimitive.Portal;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 max-w-xs overflow-hidden rounded-control bg-text px-2 py-1 text-meta font-medium text-bg shadow-overlay",
      "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
      className
    )}
    {...props}
  >
    {children}
    <TooltipPrimitive.Arrow className="fill-text" width={10} height={5} />
  </TooltipPrimitive.Content>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export interface HintProps {
  /** The tooltip text. Required — an icon-only control without one is a bug. */
  label: React.ReactNode;
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>["side"];
  align?: React.ComponentPropsWithoutRef<
    typeof TooltipPrimitive.Content
  >["align"];
  /** Optional keyboard shortcut rendered dimmed after the label. */
  shortcut?: string;
  children: React.ReactNode;
}

/**
 * Wraps any control in a tooltip. Prefer {@link IconButton} for icon-only
 * actions — it uses this internally and also wires `aria-label`, so the hint is
 * available to screen readers and not just to mouse users.
 */
export function Hint({
  label,
  side = "top",
  align = "center",
  shortcut,
  children,
}: HintProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side={side} align={align}>
          <span className="flex items-center gap-2">
            <span>{label}</span>
            {shortcut ? (
              <kbd className="rounded-[4px] border border-bg/25 px-1 font-sans text-meta uppercase text-bg/70">
                {shortcut}
              </kbd>
            ) : null}
          </span>
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipPortal,
};
