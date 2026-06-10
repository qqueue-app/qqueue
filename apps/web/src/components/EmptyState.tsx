import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Centered empty state used across list pages and empty tables. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
