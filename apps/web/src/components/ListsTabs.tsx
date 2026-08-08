import { Link, useLocation } from "react-router-dom";
import { cn } from "../lib/utils.js";
import { pageContainer, pageMeasure } from "./PageContainer.js";

const tabs = [
  { to: "/campaigns/lists", label: "Manual", end: true },
  { to: "/campaigns/lists/smart", label: "Smart", end: false },
];

/**
 * Manual lists and smart lists, as two tabs of one destination.
 *
 * §4: "smart" is a *kind* of list, not a place to go. It used to be its own
 * sidebar entry, which made the audience section look like two unrelated
 * features and cost the sidebar a row it couldn't spare.
 *
 * The active tab is computed from the path rather than taken from a `NavLink`
 * render-prop `className`, matching how the shell decides the same thing.
 */
export function ListsTabs() {
  const { pathname } = useLocation();

  return (
    <div className={cn(pageContainer, "pt-4 sm:pt-6")}>
      <div className={pageMeasure}>
        <nav
          aria-label="List type"
          className="inline-flex items-center gap-1 rounded-control bg-surface-sunken p-1"
        >
          {tabs.map((tab) => {
            const active = tab.end
              ? pathname === tab.to
              : pathname.startsWith(tab.to);

            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-touch items-center rounded-control px-3 text-ui font-medium transition-colors duration-fast ease-out sm:min-h-0 sm:py-field",
                  active
                    ? "bg-surface text-text shadow-card"
                    : "text-text-secondary hover:text-text"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
