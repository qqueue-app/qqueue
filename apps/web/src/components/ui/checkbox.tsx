import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckedState = boolean | "indeterminate";

export interface CheckboxProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "onChange" | "checked" | "type"
  > {
  /** `"indeterminate"` renders the mixed state used by a select-all header. */
  checked: CheckedState;
  onCheckedChange: (checked: boolean) => void;
  "aria-label"?: string;
}

/**
 * Controlled checkbox styled to match the design system. Dependency-free
 * (no extra Radix package) — rendered as a button with the checkbox role.
 */
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    { checked, onCheckedChange, id, disabled, className, onClick, ...props },
    ref
  ) => {
    const indeterminate = checked === "indeterminate";
    const isChecked = checked === true;
    return (
      <button
        ref={ref}
        id={id}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : isChecked}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          // A mixed checkbox resolves to "select everything", matching how
          // every mail client's select-all behaves.
          onCheckedChange(indeterminate ? true : !isChecked);
        }}
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input bg-card text-primary-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          (isChecked || indeterminate) && "border-primary bg-primary",
          className
        )}
        {...props}
      >
        {indeterminate ? (
          <Minus className="h-3 w-3" />
        ) : isChecked ? (
          <Check className="h-3 w-3" />
        ) : null}
      </button>
    );
  }
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
