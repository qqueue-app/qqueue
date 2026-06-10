import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Controlled checkbox styled to match the design system. Dependency-free
 * (no extra Radix package) — rendered as a button with the checkbox role.
 */
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, id, disabled, className, ...props }, ref) => (
    <button
      ref={ref}
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input bg-card text-primary-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked && "border-primary bg-primary",
        className
      )}
      {...props}
    >
      {checked ? <Check className="h-3 w-3" /> : null}
    </button>
  )
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
