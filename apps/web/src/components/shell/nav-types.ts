import type { LucideIcon } from "lucide-react";

/**
 * A navigation destination.
 *
 * There is no group/sub-tree variant on purpose. §4 of the design system
 * collapsed Settings — the only group there was — into a single item backed by
 * a hub page, because an expanding sub-tree is what made the sidebar tall
 * enough to need its own scrollbar. Adding one back would reintroduce that.
 */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /**
   * Match the path exactly. Needed wherever one destination's path is a prefix
   * of another's: `/campaigns` must not light up on `/campaigns/lists`.
   */
  end?: boolean;
  /**
   * Extra paths that should show this item as active. For a hub whose
   * destinations still live at top-level routes — Settings owns
   * `/smtp-connections` and friends without owning their URLs.
   */
  activePaths?: string[];
  /** Show the unread-mail count on this item. */
  badge?: "unread";
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}

/** A destination in the mobile bottom tab bar. */
export interface MobileTab {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  activePaths?: string[];
  badge?: "unread";
  /**
   * The one emphasised tab — drawn as a filled accent tile rather than a bare
   * icon. Compose, because it is the thing you open the app to do.
   */
  emphasis?: boolean;
}

function matches(path: string, pathname: string, end?: boolean): boolean {
  if (end) {
    return pathname === path;
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Whether a nav destination should render as active for the current path.
 *
 * Deliberately computed here rather than left to `NavLink`: the sidebar, the
 * bottom tab bar and the More sheet all have to agree, and only this version
 * understands `activePaths` — `NavLink` recomputes `isActive` itself and
 * overwrites any `aria-current` you hand it, so Settings would go dark the
 * moment you opened one of the pages it owns.
 *
 * Which is why every nav destination here is a plain `Link` with a string
 * `className`. That also sidesteps the other trap: a *function* `className` on
 * a `NavLink` is stringified into garbage the moment anything wraps it in a
 * Radix `asChild` slot (see CLAUDE.md).
 */
export function isNavItemActive(
  item: Pick<NavItem, "to" | "end" | "activePaths">,
  pathname: string
): boolean {
  return (
    matches(item.to, pathname, item.end) ||
    (item.activePaths ?? []).some((path) => matches(path, pathname))
  );
}
