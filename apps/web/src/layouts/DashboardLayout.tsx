import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Send,
  Server,
  Users,
  FileText,
  Megaphone,
  Settings as SettingsIcon,
  LogOut,
  Check,
  Plus,
  ChevronsUpDown,
  type LucideIcon
} from "lucide-react";
import { useSession } from "../lib/session-context.js";
import { cn } from "../lib/utils.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../components/ui/dropdown-menu.js";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/send-email", label: "Send Email", icon: Send },
  { to: "/smtp-connections", label: "SMTP Connections", icon: Server },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/settings", label: "Settings", icon: SettingsIcon }
];

export function DashboardLayout() {
  const navigate = useNavigate();
  const {
    user,
    organizations,
    currentOrganizationId,
    currentOrganization,
    setCurrentOrganizationId,
    signOut: clearSessionState
  } = useSession();
  const userEmail = user?.email;
  const initial = userEmail?.[0]?.toUpperCase() ?? "?";

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

  return (
    <div className="flex min-h-screen flex-col gap-3 p-3 md:h-screen md:flex-row md:overflow-hidden">
      <aside className="flex flex-col rounded-2xl border bg-card shadow-sm md:h-full md:w-64 md:shrink-0">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground">
            Q
          </div>
          <div className="text-sm font-semibold leading-tight">QQueue</div>
        </div>

        {user ? (
          <div className="px-3 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-1 md:flex-col md:gap-0.5 md:overflow-y-auto md:pb-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t p-3">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
          ) : (
            <NavLink
              to="/login"
              className="flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sign in
            </NavLink>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto rounded-2xl border bg-card shadow-sm md:h-full">
        <Outlet />
      </main>
    </div>
  );
}
