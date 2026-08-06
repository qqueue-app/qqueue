import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Check,
  ChevronsUpDown,
  LogOut,
  MoreHorizontal,
  PenSquare,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
import { useSession } from "../lib/session-context.js";
import { useUnreadCount } from "../lib/use-unread-count.js";
import { cn } from "../lib/utils.js";
import { BrandMark } from "../components/BrandMark.js";
import { BrandWordmark } from "../components/BrandWordmark.js";
import { DashboardSplash } from "../components/DashboardSplash.js";
import { Avatar } from "../components/ui/avatar.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Hint } from "../components/ui/tooltip.js";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import {
  mobileTabs,
  visibleSections,
  type NavLeaf,
} from "./nav-config.js";

const SPLASH_STORAGE_KEY = "qqueue.dashboard-splash-seen";
const SPLASH_DURATION_MS = 3000;

function UnreadBadge({ count, muted }: { count: number; muted?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-[0.65rem] font-semibold leading-none",
        muted
          ? "bg-primary-foreground/20 text-primary-foreground"
          : "bg-primary text-primary-foreground"
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * The application frame.
 *
 * Desktop gets a persistent sidebar. Phones get a bottom tab bar instead — the
 * reachable third of the screen on a hand-held device — with a floating compose
 * button, because writing mail is the one action worth a permanent target.
 * Both read from the same nav config so the two can't disagree.
 */
export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useUnreadCount();
  const [showSplash, setShowSplash] = useState(() => {
    if (import.meta.env.MODE === "test") return false;
    try {
      return window.sessionStorage.getItem(SPLASH_STORAGE_KEY) !== "true";
    } catch {
      return true;
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const {
    user,
    organizations,
    currentOrganizationId,
    currentOrganization,
    setCurrentOrganizationId,
    signOut: clearSessionState,
  } = useSession();

  const userEmail = user?.email;
  const isOrgAdmin =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";
  const sections = visibleSections(Boolean(isOrgAdmin));

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!showSplash) return;
    const timeoutId = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(SPLASH_STORAGE_KEY, "true");
      } catch {
        // Private browsing or strict storage settings can block sessionStorage.
      }
      setShowSplash(false);
    }, SPLASH_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [showSplash]);

  function switchOrganization(organizationId: string, name: string) {
    if (organizationId === currentOrganizationId) return;
    // Every query key carries the organization id, so switching swaps caches
    // rather than mixing one org's rows into another's view.
    setCurrentOrganizationId(organizationId);
    toast.success(`Switched to ${name}.`);
  }

  function signOut() {
    clearSessionState();
    navigate("/login");
  }

  function NavItem({ item, onNavigate }: { item: NavLeaf; onNavigate?: () => void }) {
    const Icon = item.icon;
    const badge = item.badge === "unread" ? unread : 0;
    return (
      <Hint label={item.hint} side="right">
        <NavLink
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              <UnreadBadge count={badge} muted={isActive} />
            </>
          )}
        </NavLink>
      </Hint>
    );
  }

  function OrganizationSwitcher() {
    if (!user) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-xl border bg-background/70 px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar
            name={currentOrganization?.name ?? "Q"}
            size="sm"
            initials={(currentOrganization?.name ?? "Q")
              .slice(0, 1)
              .toUpperCase()}
            className="rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              Organization
            </div>
            <div className="truncate text-sm font-medium">
              {currentOrganization?.name ?? "Select organization"}
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            Switch organization
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.length === 0 ? (
            <DropdownMenuItem disabled>No organizations</DropdownMenuItem>
          ) : (
            organizations.map((organization) => (
              <DropdownMenuItem
                key={organization.id}
                onSelect={() =>
                  switchOrganization(organization.id, organization.name)
                }
              >
                <span className="flex-1 truncate">{organization.name}</span>
                {organization.id === currentOrganizationId ? (
                  <Check className="h-4 w-4" />
                ) : null}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            <Plus className="h-4 w-4" />
            New organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function AccountMenu() {
    if (!user) {
      return (
        <NavLink
          to="/login"
          className="flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in
        </NavLink>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar name={user.name || userEmail || "?"} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {user.name ?? "Account"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {userEmail}
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {userEmail}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            <SettingsIcon className="h-4 w-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={signOut}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_34rem)] md:h-[100dvh] md:flex-row md:gap-3 md:overflow-hidden md:p-3">
      {showSplash ? <DashboardSplash /> : null}

      {/* Desktop sidebar */}
      <aside className="hidden flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-sm shadow-slate-950/[0.04] md:flex md:h-full md:w-64 md:shrink-0">
        <div className="flex items-center gap-3 px-5 py-5">
          <BrandWordmark />
        </div>
        <div className="px-3 pb-3">
          <OrganizationSwitcher />
        </div>
        <div className="px-3 pb-3">
          <NavLink
            to="/email-studio"
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/25 transition-colors hover:bg-primary/90"
          >
            <PenSquare className="h-4 w-4" />
            Compose
          </NavLink>
        </div>

        <nav
          aria-label="Main"
          className="flex flex-1 flex-col overflow-y-auto px-3 pb-3"
        >
          {sections.map((section, index) => (
            <div
              key={section.heading ?? index}
              className={cn("flex flex-col gap-0.5", index > 0 && "mt-4")}
            >
              {section.heading ? (
                <div className="px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section.heading}
                </div>
              ) : null}
              {section.items.map((item) => (
                <NavItem key={item.to} item={item} />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t bg-muted/20 p-3">
          <div className="mb-2 grid grid-cols-3 gap-1 px-1 text-center text-xs text-muted-foreground">
            <NavLink
              to="/terms"
              className="rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground"
            >
              Terms
            </NavLink>
            <NavLink
              to="/privacy"
              className="rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground"
            >
              Privacy
            </NavLink>
            <NavLink
              to="/licensing"
              className="rounded-md px-1.5 py-1 hover:bg-accent hover:text-foreground"
            >
              Licensing
            </NavLink>
          </div>
          <div className="flex items-center gap-1">
            <AccountMenu />
          </div>
        </div>
      </aside>

      {/* Mobile top bar — identity and account only; navigation lives at the bottom. */}
      <header className="flex items-center justify-between border-b bg-card/95 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark className="h-7 w-7 shrink-0 rounded-lg" />
          <span className="truncate text-sm font-semibold">
            {currentOrganization?.name ?? "QQueue"}
          </span>
        </div>
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Account and organization" size="sm">
                <Avatar name={user.name || userEmail || "?"} size="sm" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                {userEmail}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onSelect={() =>
                    switchOrganization(organization.id, organization.name)
                  }
                >
                  <span className="flex-1 truncate">{organization.name}</span>
                  {organization.id === currentOrganizationId ? (
                    <Check className="h-4 w-4" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/settings")}>
                <SettingsIcon className="h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={signOut}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:h-full md:rounded-2xl md:border md:bg-card/95 md:pb-0 md:shadow-sm md:shadow-slate-950/[0.04]">
        <Outlet />
      </main>

      {/* Mobile bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {mobileTabs.map((item) => {
          const Icon = item.icon;
          const badge = item.badge === "unread" ? unread : 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {badge > 0 ? (
                  <span className="absolute -right-2 -top-1 min-w-[1rem] rounded-full bg-primary px-1 text-center text-[0.6rem] font-semibold leading-4 text-primary-foreground">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </span>
              {item.label}
            </NavLink>
          );
        })}

        {/* Compose sits in the bar rather than as a floating button so it can't
            cover the last row of a list. */}
        <NavLink
          to="/email-studio"
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )
          }
        >
          <PenSquare className="h-5 w-5" />
          Compose
        </NavLink>

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More sections"
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] font-medium text-muted-foreground transition-colors"
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      {/* Everything that doesn't fit the bottom bar. A bottom sheet rather than
          a side drawer: it opens under the thumb that summoned it. */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="md:hidden">
          <SheetHeader className="border-0 pb-0">
            <SheetTitle>Everything else</SheetTitle>
          </SheetHeader>
          <SheetBody className="pt-2">
            {sections.map((section) => (
              <div key={section.heading} className="mb-4 last:mb-0">
                <div className="px-1 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section.heading}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            "flex min-h-[3.25rem] items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                            isActive
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "hover:bg-accent"
                          )
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        {item.badge === "unread" && unread > 0 ? (
                          <UnreadBadge count={unread} />
                        ) : null}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
