import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils.js";

export interface SettingsLink {
  to: string;
  title: string;
  description: string;
}

/**
 * One destination on a hub page: title, one-line description, chevron.
 *
 * Rows rather than cards, because a link is not a container — a grid of
 * bordered tiles makes eight destinations look like eight warnings. The whole
 * row is the target and it is at least 44px tall, so it is a comfortable tap
 * on a phone without being drawn any larger on a desktop.
 */
export function SettingsLinkRow({ to, title, description }: SettingsLink) {
  return (
    <li>
      <Link
        to={to}
        className={cn(
          "flex min-h-touch items-center gap-4 border-b border-border py-3",
          "transition-colors duration-fast ease-out hover:bg-surface-sunken"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-text">{title}</div>
          <div className="text-ui text-text-secondary">{description}</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
      </Link>
    </li>
  );
}

/**
 * A titled group of link rows.
 *
 * The hub groups by *scope* — what you are configuring — because that is the
 * distinction the old page lost: org-scoped and user-scoped settings sat in one
 * grid, and "Sign out" ended up looking like something you did to the
 * organization (§6, anti-pattern 8).
 */
export function SettingsLinkGroup({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-meta font-medium uppercase tracking-eyebrow text-text-tertiary">
        {heading}
      </h2>
      <ul className="mt-2 border-t border-border">{children}</ul>
    </div>
  );
}
