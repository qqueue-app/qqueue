import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils.js";
import { BrandWordmark } from "../BrandWordmark.js";
import { AccountMenu } from "./AccountMenu.js";
import { OrgSwitcher } from "./OrgSwitcher.js";
import { isNavItemActive, type NavSection } from "./nav-types.js";

interface SidebarNavProps {
  sections: NavSection[];
  unread: number;
  /** The drawer draws its own header with a close button, so it hides this one. */
  showBrand?: boolean;
}

/**
 * The sidebar's contents: brand, org, destinations, account.
 *
 * **Nothing here may scroll.** The whole point of §4's restructure — Settings
 * collapsed to one item, Smart lists folded into Lists — was to make the nav
 * short enough that it never needs to. If a future destination pushes this past
 * the viewport, the fix is to fold it into a hub page, not to add
 * `overflow-y-auto` and call it done.
 */
export function SidebarNav({
  sections,
  unread,
  showBrand = true,
}: SidebarNavProps) {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showBrand ? (
        <div className="flex h-14 shrink-0 items-center px-4">
          <BrandWordmark />
        </div>
      ) : null}

      <div className="px-3 pb-3">
        <OrgSwitcher />
      </div>

      <nav aria-label="Main" className="flex flex-col gap-3 px-3">
        {sections.map((section, index) => (
          <div
            key={section.heading ?? `section-${index}`}
            className={cn(
              "flex flex-col gap-0.5",
              // A section with no heading is a break in rhythm rather than a
              // new category, so it gets a hairline instead of a label.
              index > 0 && !section.heading && "border-t border-border pt-3"
            )}
          >
            {section.heading ? (
              <div className="px-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-eyebrow text-text-tertiary">
                {section.heading}
              </div>
            ) : null}

            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(item, pathname);

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-control px-2 text-ui font-medium transition-colors duration-fast ease-out",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-text-secondary hover:bg-surface-sunken hover:text-text"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge === "unread" && unread > 0 ? (
                    <span
                      data-numeric
                      className="min-w-[1.25rem] rounded-pill bg-primary px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold leading-none text-primary-foreground"
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Pushes the account block to the bottom without making anything scroll. */}
      <div className="flex-1" aria-hidden />

      <div className="shrink-0 border-t border-border px-3 py-2">
        <div className="flex items-center justify-between gap-1 px-1 pb-1 text-meta text-text-tertiary">
          <Link
            to="/terms"
            className="rounded-control px-1 py-1 hover:text-text"
          >
            Terms
          </Link>
          <Link
            to="/privacy"
            className="rounded-control px-1 py-1 hover:text-text"
          >
            Privacy
          </Link>
          <Link
            to="/licensing"
            className="rounded-control px-1 py-1 hover:text-text"
          >
            Licensing
          </Link>
        </div>
        <AccountMenu />
      </div>
    </div>
  );
}
