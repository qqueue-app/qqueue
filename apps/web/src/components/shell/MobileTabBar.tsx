import { Link, useLocation } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { isNavItemActive, type MobileTab } from "./nav-types.js";

interface MobileTabBarProps {
  tabs: MobileTab[];
  unread: number;
  moreOpen: boolean;
  onOpenMore: () => void;
}

const tabClass =
  "flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors duration-fast ease-out";
const labelClass = "text-[0.6875rem] font-medium leading-none";

/**
 * The phone's primary navigation: five destinations across the bottom, where a
 * thumb already is. Shown below 640px only — above it the sidebar is back.
 *
 * Fixed rather than sticky so it survives any page's scroll position, and
 * padded by the home-indicator inset so the labels aren't sitting under it.
 */
export function MobileTabBar({
  tabs,
  unread,
  moreOpen,
  onOpenMore,
}: MobileTabBarProps) {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-safe-b pl-safe-l pr-safe-r sm:hidden"
    >
      <ul className="flex h-tabbar items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = !moreOpen && isNavItemActive(tab, pathname);

          return (
            <li key={tab.to} className="flex flex-1">
              <Link
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  tabClass,
                  active ? "text-primary" : "text-text-secondary"
                )}
              >
                <span className="relative">
                  {tab.emphasis ? (
                    /*
                      The one action the app exists for. Drawn as a filled tile
                      rather than given a bigger icon, so it reads as primary
                      without breaking the row's rhythm.
                    */
                    <span
                      className={cn(
                        "flex h-[1.75rem] w-10 items-center justify-center rounded-control transition-colors duration-fast ease-out",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-accent text-accent-foreground"
                      )}
                    >
                      <Icon className="h-[1.375rem] w-[1.375rem]" />
                    </span>
                  ) : (
                    <Icon className="h-[1.375rem] w-[1.375rem]" />
                  )}
                  {tab.badge === "unread" && unread > 0 ? (
                    <span
                      data-numeric
                      aria-hidden
                      className="absolute -right-2 -top-1 min-w-[1rem] rounded-pill bg-primary px-1 text-center text-[0.625rem] font-semibold leading-4 text-primary-foreground"
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </span>
                <span className={labelClass}>{tab.label}</span>
                {tab.badge === "unread" && unread > 0 ? (
                  <span className="sr-only">{unread} unread</span>
                ) : null}
              </Link>
            </li>
          );
        })}

        <li className="flex flex-1">
          <button
            type="button"
            onClick={onOpenMore}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={cn(
              tabClass,
              moreOpen ? "text-primary" : "text-text-secondary"
            )}
          >
            <MoreHorizontal className="h-[1.375rem] w-[1.375rem]" />
            <span className={labelClass}>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
