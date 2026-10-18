import { Hint } from "../ui/tooltip.js";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../../lib/utils.js";
import { PenSquare, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { BrandWordmark } from "../BrandWordmark.js";
import { OrgSwitcher } from "./OrgSwitcher.js";
import { isNavItemActive, type NavSection } from "./nav-types.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";

interface SidebarNavProps {
  sections: NavSection[];
  unread: number;
  /** The drawer draws its own header with a close button, so it hides this one. */
  showBrand?: boolean;
}

/** Folder navigation, organization context, Compose, and secondary tools. */
export function SidebarNav({
  sections,
  unread,
  showBrand = true,
}: SidebarNavProps) {
  const { pathname, search } = useLocation();
  const [showFolders, setShowFolders] = useState(false);
  const tools = sections.flatMap((section) =>
    section.items.filter((item) => item.advanced)
  );
  const dailySections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          !item.advanced && item.to !== "/email-studio" && item.to !== "/search"
      ),
    }))
    .filter((section) => section.items.length);
  const toolActive = tools.some((item) =>
    isNavItemActive(item, pathname, search)
  );

  return (
    <div className="mail-sidebar-content flex min-h-0 flex-1 flex-col">
      <Link
        to="/email-studio"
        aria-label="Compose"
        className="mail-compose-button"
      >
        <PenSquare className="h-6 w-6" />
        <span>Compose</span>
      </Link>
      {showBrand ? (
        <span className="sr-only">
          <BrandWordmark />
        </span>
      ) : null}
      <div className="mail-org-switcher">
        <OrgSwitcher />
      </div>
      <nav aria-label="Main" className="flex flex-col gap-3 px-3">
        {dailySections.map((section, index) => (
          <div
            key={section.heading ?? `section-${index}`}
            className={cn(
              "flex flex-col gap-1",
              // A section with no heading is a break in rhythm rather than a
              // new category, so it gets a hairline instead of a label.
              index > 0 && !section.heading && "border-t border-border pt-3"
            )}
          >
            {section.heading ? (
              <div className="px-2 pb-1 text-eyebrow font-medium uppercase tracking-eyebrow text-text-tertiary">
                {section.heading}
              </div>
            ) : null}

            {section.items
              .filter(
                (item) =>
                  showFolders ||
                  ![
                    "Archive",
                    "Trash",
                    "Spam",
                    "All mail",
                    "Other folders",
                  ].includes(item.label)
              )
              .map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(item, pathname, search);

                return (
                  <Hint key={item.to} label={item.label} side="right">
                    <Link
                      aria-label={
                        item.badge === "unread" && unread > 0
                          ? `${item.label} ${unread} unread`
                          : item.label
                      }
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "mail-nav-item",
                        active
                          ? "mail-nav-active"
                          : "text-text-secondary hover:bg-surface-sunken hover:text-text"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === "unread" && unread > 0 ? (
                        <span
                          data-numeric
                          className="min-w-badge rounded-pill bg-primary px-field py-1 text-center text-eyebrow font-semibold leading-none text-primary-foreground"
                        >
                          {unread > 99 ? "99+" : unread}
                        </span>
                      ) : null}
                    </Link>
                  </Hint>
                );
              })}
          </div>
        ))}
        <button
          type="button"
          aria-label={showFolders ? "Less" : "More folders"}
          className="mail-nav-item text-text-secondary"
          aria-expanded={showFolders}
          onClick={() => setShowFolders(!showFolders)}
        >
          {showFolders ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          <span>{showFolders ? "Less" : "More folders"}</span>
        </button>
      </nav>
      {tools.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "mx-3 mt-2 min-h-touch rounded-control px-2 text-left text-ui hover:bg-surface-sunken",
              toolActive ? "mail-nav-active" : "text-text-secondary"
            )}
          >
            More tools
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end">
            {tools.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem key={item.to} asChild>
                  <Link
                    to={item.to}
                    aria-current={
                      isNavItemActive(item, pathname, search)
                        ? "page"
                        : undefined
                    }
                  >
                    <Icon />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/* Legal links stay below the folder navigation. */}
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
      </div>
    </div>
  );
}
