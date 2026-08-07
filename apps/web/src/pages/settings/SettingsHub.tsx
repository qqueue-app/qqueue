import { PageHeader } from "../../components/PageHeader.js";
import { FormColumn } from "../../components/settings/FormColumn.js";
import {
  SettingsLinkGroup,
  SettingsLinkRow,
  type SettingsLink,
} from "../../components/settings/SettingsLinkRow.js";
import { useSession } from "../../lib/session-context.js";
import { useInstanceAdmin } from "../../lib/use-instance-admin.js";

interface HubLink extends SettingsLink {
  /** Hidden from MEMBERs — the matching API routes would 403 anyway. */
  orgAdminOnly?: boolean;
  /** Hidden from everyone but instance admins, probe pending included. */
  instanceAdminOnly?: boolean;
}

/**
 * Settings, grouped by *what you are configuring* rather than by feature.
 *
 * The scope split is the point. The old page put "Sign out" in a grid beside
 * "Rename organization", which made a user-scoped action look like an
 * org-scoped one — §6's eighth anti-pattern, and the reason Account is its own
 * group at the bottom here.
 */
const groups: { heading: string; links: HubLink[] }[] = [
  {
    heading: "Organization",
    links: [
      {
        to: "/settings/organization",
        title: "Organization",
        description: "Its name, and the other workspaces you belong to.",
      },
      {
        to: "/settings/team",
        title: "Team",
        description: "Who is in this organization, and what they can do.",
        orgAdminOnly: true,
      },
      {
        to: "/settings/sending",
        title: "Sending accounts",
        description: "The accounts your mail goes out as, and how it is landing.",
      },
      {
        to: "/settings/mailboxes",
        title: "Mailboxes",
        description: "Inboxes QQueue syncs, so replies come back here.",
        orgAdminOnly: true,
      },
      {
        to: "/settings/suppressions",
        title: "Suppressions",
        description: "Addresses QQueue will never email, across every send.",
      },
      {
        to: "/settings/api",
        title: "API",
        description: "Keys and webhooks, for sending from your own code.",
      },
    ],
  },
  {
    heading: "Advanced",
    links: [
      {
        to: "/settings/instance",
        title: "Instance",
        description: "Server-wide settings and configuration health.",
        instanceAdminOnly: true,
      },
      {
        to: "/queue-operations",
        title: "Background jobs",
        description: "The delivery queue, its workers, and anything stuck.",
        orgAdminOnly: true,
      },
    ],
  },
  {
    heading: "You",
    links: [
      {
        to: "/settings/account",
        title: "Account",
        description:
          "Your sign-in, alerts on this device, and signing out.",
      },
    ],
  },
];

/**
 * The Settings hub: one row per destination, each its own route.
 *
 * All of this used to be a single scrolling page of stacked cards, with an
 * expanding sub-tree in the sidebar pointing at half of it. §4 replaced both:
 * the sidebar has one Settings item, and this page is where it leads. "More
 * pages are fine as long as navigation makes them easy to find" — this is the
 * finding.
 */
export function SettingsHub() {
  const { currentOrganization } = useSession();
  const { isInstanceAdmin } = useInstanceAdmin();
  const isOrgAdmin =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => {
        if (link.orgAdminOnly && !isOrgAdmin) return false;
        // `undefined` while the probe is in flight: better a row that appears a
        // beat late than one that flashes in and out for everyone else.
        if (link.instanceAdminOnly && isInstanceAdmin !== true) return false;
        return true;
      }),
    }))
    .filter((group) => group.links.length > 0);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your organization, your team, and the technical bits."
      />

      <FormColumn>
        <nav aria-label="Settings sections" className="space-y-6">
          {visibleGroups.map((group) => (
            <SettingsLinkGroup key={group.heading} heading={group.heading}>
              {group.links.map((link) => (
                <SettingsLinkRow key={link.to} {...link} />
              ))}
            </SettingsLinkGroup>
          ))}
        </nav>
      </FormColumn>
    </>
  );
}
