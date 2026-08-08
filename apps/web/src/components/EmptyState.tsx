import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Empty state — compact and useful, not a monument.
 *
 * One line stating the fact, one line saying what will put content here, one
 * *secondary* button. Deliberately no bordered container and no icon tile: a
 * big outlined box with an icon adrift in it makes "you have nothing yet" look
 * like an error, and the caller usually already sits inside a bordered surface.
 */
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
        "mx-auto flex max-w-empty flex-col items-center gap-2 px-6 py-12 text-center",
        className
      )}
    >
      {Icon ? (
        <Icon className="h-5 w-5 text-text-tertiary" aria-hidden />
      ) : null}
      <p className="text-body font-medium text-text">{title}</p>
      {description ? (
        <p className="text-ui leading-6 text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
