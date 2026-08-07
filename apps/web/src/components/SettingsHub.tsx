import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useSession } from "../lib/session-context.js";

interface HubLink {
  to: string;
  title: string;
  description: string;
  /** Hidden from MEMBERs — the matching API routes would 403 anyway. */
  adminOnly?: boolean;
}

const links: HubLink[] = [
  {
    to: "/smtp-connections",
    title: "Sending accounts",
    description: "The SMTP servers and addresses your mail goes out as.",
  },
  {
    to: "/mailboxes",
    title: "Mailboxes",
    description: "Inboxes QQueue syncs, so replies come back here.",
    adminOnly: true,
  },
  {
    to: "/deliverability",
    title: "Sending health",
    description: "Bounce and complaint rates, and what they mean for you.",
  },
  {
    to: "/suppressions",
    title: "Blocked addresses",
    description: "Addresses QQueue will never email, across every send.",
  },
  {
    to: "/queue-operations",
    title: "Background jobs",
    description: "The delivery queue, its workers, and anything stuck.",
    adminOnly: true,
  },
];

/**
 * The Settings hub: one row per destination, each its own page.
 *
 * These five used to be a expanding sub-tree in the sidebar. §4 collapsed
 * Settings to a single nav item — which only works if the things it used to
 * expand into are listed *somewhere*, and this is that somewhere. Rows rather
 * than cards, in a 640px column, because a link is not a container.
 */
export function SettingsHub() {
  const { currentOrganization } = useSession();
  const isOrgAdmin =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";
  const visible = links.filter((link) => !link.adminOnly || isOrgAdmin);

  return (
    <nav aria-label="Settings sections" className="max-w-[40rem]">
      <ul className="border-t border-border">
        {visible.map((link) => (
          <li key={link.to}>
            <Link
              to={link.to}
              className="flex min-h-touch items-center gap-4 border-b border-border py-3 transition-colors duration-fast ease-out hover:bg-surface-sunken"
            >
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium text-text">
                  {link.title}
                </div>
                <div className="text-ui text-text-secondary">
                  {link.description}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
