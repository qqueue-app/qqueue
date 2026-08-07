import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/**
 * Toggle — 36×20px. Accent when on, `--border-strong` track when off.
 *
 * In a settings row the label goes to the LEFT of the toggle and the control to
 * the right; see `SettingsRow`.
 *
 * The 20px control is well under the 44px touch minimum, so it carries the same
 * invisible touch slop as a button rather than being drawn larger.
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, id, disabled, className, ...props }, ref) => (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill px-0.5",
        "transition-colors duration-fast ease-out",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-border-strong",
        // `-inset-x-1`, not `inset-x-0`: the control is 36px wide, so a slop
        // that only spans its own width tops out at 36 and misses the 44px
        // minimum on the axis nobody checks. 4px each side closes the gap.
        "after:absolute after:-inset-x-1 after:top-1/2 after:h-touch",
        "after:-translate-y-1/2 after:content-[''] sm:after:hidden",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-pill bg-surface shadow-card",
          "transition-transform duration-fast ease-out",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  )
);
Switch.displayName = "Switch";

/**
 * A settings row: label and description on the left, control on the right,
 * separated from its neighbours by a hairline. This replaces grids of bordered
 * toggle boxes — a border around every option makes a list of choices look like
 * a list of warnings.
 */
export interface SettingsRowProps {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  className
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border py-3 last:border-0",
        className
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={htmlFor}
          className="block text-ui font-medium text-text"
        >
          {label}
        </label>
        {description ? (
          <p className="mt-1 text-meta text-text-secondary">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

export { Switch, SettingsRow };
