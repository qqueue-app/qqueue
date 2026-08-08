import { Link, useLocation } from "react-router-dom";
import { cn } from "../lib/utils.js";

const tabs = [
  { to: "/campaigns", label: "Campaigns", end: true },
  { to: "/campaigns/recurring", label: "Recurring", end: false },
];

/**
 * One-off campaigns and recurring sends, as two tabs of one destination.
 *
 * Recurring sends had to leave the composer's rail — they are scheduled
 * campaigns, not options for the message you are writing (§4) — but they could
 * not become a twelfth sidebar row either: that nav is already about 690px
 * tall and is forbidden from scrolling. Same reasoning as [ListsTabs], where
 * "smart" is a kind of list rather than a place to go.
 *
 * The active tab is computed from the path rather than taken from a `NavLink`
 * render-prop `className`, matching how the shell decides the same thing.
 */
export function CampaignsTabs() {
  const { pathname } = useLocation();

  return (
    <div className="px-4 pt-4 sm:px-6 sm:pt-6">
      <nav
        aria-label="Campaign type"
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
  );
}
