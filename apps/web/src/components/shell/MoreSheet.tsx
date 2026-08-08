import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.js";
import { AccountMenu } from "./AccountMenu.js";
import { OrgSwitcher } from "./OrgSwitcher.js";
import { isNavItemActive, type NavSection } from "./nav-types.js";

interface MoreSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: NavSection[];
  /** Destinations already reachable from the tab bar; listing them twice is noise. */
  excludePaths: string[];
  unread: number;
}

/**
 * Everything the bottom tab bar has no room for.
 *
 * Full-screen rather than a peek-height bottom sheet: this is the phone's
 * equivalent of the sidebar, and a list you have to scroll inside a 40%-tall
 * panel is worse than one that owns the screen. It is a dialog, so the scroll
 * inside it is one of §2's named exceptions — and Radix locks the document
 * behind it, so there is still only ever one scrollbar.
 */
export function MoreSheet({
  open,
  onOpenChange,
  sections,
  excludePaths,
  unread,
}: MoreSheetProps) {
  const { pathname } = useLocation();

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !excludePaths.includes(item.to)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="full"
        className="sm:hidden"
        aria-describedby={undefined}
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>More</SheetTitle>
        </SheetHeader>

        <SheetBody className="px-0 py-0">
          <div className="px-4 py-4">
            <OrgSwitcher />
          </div>

          {visibleSections.map((section, index) => (
            <div key={section.heading ?? `section-${index}`} className="pb-2">
              {section.heading ? (
                <div className="px-4 pb-1 pt-3 text-eyebrow font-medium uppercase tracking-eyebrow text-text-tertiary">
                  {section.heading}
                </div>
              ) : null}

              <ul>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(item, pathname);

                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => onOpenChange(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-touch items-center gap-3 border-b border-border px-4 py-3 text-body font-medium transition-colors duration-fast ease-out",
                          active ? "text-primary" : "text-text"
                        )}
                      >
                        <Icon className="h-icon-row w-icon-row shrink-0 text-text-tertiary" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge === "unread" && unread > 0 ? (
                          <span
                            data-numeric
                            className="min-w-badge rounded-pill bg-primary px-field py-1 text-center text-eyebrow font-semibold leading-none text-primary-foreground"
                          >
                            {unread > 99 ? "99+" : unread}
                          </span>
                        ) : null}
                        <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="flex items-center justify-center gap-4 px-4 py-4 text-meta text-text-tertiary">
            <Link to="/terms" onClick={() => onOpenChange(false)}>
              Terms
            </Link>
            <Link to="/privacy" onClick={() => onOpenChange(false)}>
              Privacy
            </Link>
            <Link to="/licensing" onClick={() => onOpenChange(false)}>
              Licensing
            </Link>
          </div>
        </SheetBody>

        <div className="shrink-0 border-t border-border px-3 py-2">
          <AccountMenu />
        </div>
      </SheetContent>
    </Sheet>
  );
}
