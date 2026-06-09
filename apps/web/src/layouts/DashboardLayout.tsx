import { NavLink, Outlet } from "react-router-dom";
import { getSession } from "../lib/session.js";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/send-email", label: "Send Email" },
  { to: "/smtp-connections", label: "SMTP Connections" },
  { to: "/contacts", label: "Contacts" },
  { to: "/templates", label: "Templates" },
  { to: "/campaigns", label: "Campaigns" },
  { to: "/settings", label: "Settings" }
];

export function DashboardLayout() {
  const session = getSession();
  const currentOrganization = session.organizations.find(
    (organization) => organization.id === session.currentOrganizationId
  );

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
        <div className="px-5 py-5">
          <div className="text-xl font-semibold text-ink">QQueue</div>
          <div className="mt-1 text-xs uppercase text-slate-500">
            {currentOrganization?.name ?? "Email platform"}
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "block rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
                  isActive
                    ? "bg-moss text-white"
                    : "text-slate-700 hover:bg-slate-100"
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-5 py-4 text-sm text-slate-600">
          {session.user ? (
            <div className="truncate">{session.user.email}</div>
          ) : (
            <NavLink to="/login" className="font-medium text-moss">
              Sign in
            </NavLink>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
