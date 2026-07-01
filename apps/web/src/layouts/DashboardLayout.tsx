import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Home,
  Inbox,
  PenSquare,
  Users,
  List,
  Sparkles,
  FileText,
  Megaphone,
  Settings as SettingsIcon,
  LogOut,
  Check,
  Plus,
  ChevronsUpDown,
  ChevronRight,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "../lib/session-context.js";
import { cn } from "../lib/utils.js";
import { BrandMark } from "../components/BrandMark.js";
import { BrandWordmark } from "../components/BrandWordmark.js";
import { DashboardSplash } from "../components/DashboardSplash.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";

// Only shown to OWNER/ADMIN members; the matching API routes are restricted to
// those roles via requireOrgRole, so showing the link to MEMBERs would only
// lead to a 403.
interface NavChild {
  to: string;
  label: string;
  adminOnly?: boolean;
}

interface NavLeaf {
  to: string;
  label: string;
  icon: LucideIcon;
  // Force exact-match active styling (NavLink `end`). Defaults on for "/" and
  // any "/campaigns*" leaf so sibling routes that share the prefix don't all
  // light up at once.
  end?: boolean;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavChild[];
}

type NavItem = NavLeaf | NavGroup;

interface NavSection {
  heading?: string;
  items: NavItem[];
}

function isGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

// Nav is organised by job-to-be-done so everyday tasks lead and the technical
// plumbing (sending accounts, deliverability, suppression list, job queue) is
// tucked into a single collapsed Settings group instead of competing for
// attention at the top level. See docs/DECISIONS.md.
const navSections: NavSection[] = [
  {
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/email-studio", label: "Compose", icon: PenSquare },
      { to: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    heading: "Audience",
    items: [
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/campaigns/lists", label: "Lists", icon: List },
      { to: "/campaigns/segments", label: "Smart lists", icon: Sparkles },
    ],
  },
  {
    heading: "Campaigns",
    items: [
      { to: "/templates", label: "Templates", icon: FileText },
      { to: "/campaigns", label: "Campaigns", icon: Megaphone },
    ],
  },
  {
    items: [
      {
        label: "Settings",
        icon: SettingsIcon,
        children: [
          { to: "/smtp-connections", label: "Sending accounts" },
          { to: "/deliverability", label: "Sending health" },
          { to: "/suppressions", label: "Blocked addresses" },
          { to: "/queue-operations", label: "Background jobs", adminOnly: true },
          { to: "/settings", label: "Organization" },
        ],
      },
    ],
  },
];

const SPLASH_STORAGE_KEY = "qqueue.dashboard-splash-seen";
const SPLASH_DURATION_MS = 3000;

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showSplash, setShowSplash] = useState(() => {
    if (import.meta.env.MODE === "test") {
      return false;
    }

    try {
      return window.sessionStorage.getItem(SPLASH_STORAGE_KEY) !== "true";
    } catch {
      return true;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const {
    user,
    organizations,
    currentOrganizationId,
    currentOrganization,
    setCurrentOrganizationId,
    signOut: clearSessionState,
  } = useSession();
  const userEmail = user?.email;
  const initial = userEmail?.[0]?.toUpperCase() ?? "?";
  const isOrgAdmin =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item): NavItem | null => {
          if (isGroup(item)) {
            const children = item.children.filter(
              (child) => !child.adminOnly || isOrgAdmin
            );
            return children.length ? { ...item, children } : null;
          }
          return !item.adminOnly || isOrgAdmin ? item : null;
        })
        .filter((item): item is NavItem => item !== null),
    }))
    .filter((section) => section.items.length > 0);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!showSplash) {
      return;
    }

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

  // Auto-expand a nav group when the current route lives inside one of its
  // children.
  useEffect(() => {
    navSections.forEach((section) => {
      section.items.forEach((item) => {
        if (
          isGroup(item) &&
          item.children.some(
            (child) =>
              location.pathname === child.to ||
              location.pathname.startsWith(`${child.to}/`)
          )
        ) {
          setOpenGroups((current) => ({ ...current, [item.label]: true }));
        }
      });
    });
  }, [location.pathname]);

  function switchOrganization(organizationId: string, name: string) {
    if (organizationId === currentOrganizationId) {
      return;
    }
    setCurrentOrganizationId(organizationId);
    toast.success(`Switched to ${name}.`);
  }

  function signOut() {
    clearSessionState();
    navigate("/login");
  }

  function SidebarBody({ showLogo = true }: { showLogo?: boolean }) {
    return (
      <>
        {showLogo ? (
          <div className="flex items-center gap-3 px-5 py-5">
            <BrandWordmark />
          </div>
        ) : null}

        {user ? (
          <div className="px-3 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-xl border bg-background/70 px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                  {(currentOrganization?.name ?? "Q").slice(0, 1).toUpperCase()}
                </div>
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
                      <span className="flex-1 truncate">
                        {organization.name}
                      </span>
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
          </div>
        ) : null}

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
          {visibleSections.map((section, sectionIndex) => (
            <div
              key={section.heading ?? `section-${sectionIndex}`}
              className={cn(
                "flex flex-col gap-1",
                sectionIndex > 0 &&
                  (section.heading
                    ? "mt-4"
                    : "mt-3 border-t border-border/60 pt-3")
              )}
            >
              {section.heading ? (
                <div className="px-3 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section.heading}
                </div>
              ) : null}

              {section.items.map((item) => {
                const Icon = item.icon;

                if (isGroup(item)) {
                  const groupActive = item.children.some(
                    (child) =>
                      location.pathname === child.to ||
                      location.pathname.startsWith(`${child.to}/`)
                  );
                  const open = openGroups[item.label] ?? groupActive;

                  return (
                    <div key={item.label}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenGroups((current) => ({
                            ...current,
                            [item.label]: !open,
                          }))
                        }
                        className={cn(
                          "flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          groupActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform",
                            open && "rotate-90"
                          )}
                        />
                      </button>
                      {open ? (
                        <div className="mt-0.5 flex flex-col gap-0.5 pl-7">
                          {item.children.map((child) => (
                            <NavLink
                              key={child.to}
                              to={child.to}
                              end
                              className={({ isActive }) =>
                                cn(
                                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                  isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                )
                              }
                            >
                              {child.label}
                            </NavLink>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={
                      item.end ?? (item.to === "/" || item.to.startsWith("/campaigns"))
                    }
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t bg-muted/20 p-3">
          <div className="mb-3 grid grid-cols-3 gap-1 px-1 text-center text-xs text-muted-foreground">
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
          {user ? (
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                    {initial}
                  </div>
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
            </div>
          ) : (
            <NavLink
              to="/login"
              className="flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in
            </NavLink>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.08),transparent_34rem)] p-3 md:h-screen md:flex-row md:overflow-hidden">
      {showSplash ? <DashboardSplash /> : null}

      {/* Desktop sidebar */}
      <aside className="hidden flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-sm shadow-slate-950/[0.04] md:flex md:h-full md:w-64 md:shrink-0">
        <SidebarBody />
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between rounded-2xl border bg-card/95 px-3 py-2.5 shadow-sm md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <BrandMark className="h-7 w-7 rounded-lg" />
          <span className="text-sm font-semibold">QQueue</span>
        </div>
        <div className="h-9 w-9" aria-hidden />
      </header>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 animate-in fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-card shadow-xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-5 py-4">
              <BrandWordmark />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarBody showLogo={false} />
          </aside>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 overflow-y-auto rounded-2xl border bg-card/95 shadow-sm shadow-slate-950/[0.04] md:h-full">
        <Outlet />
      </main>
    </div>
  );
}
