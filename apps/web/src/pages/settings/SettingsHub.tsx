import { PageContainer } from "../../components/PageContainer.js";
import { PageHeader } from "../../components/PageHeader.js";

import {
  SettingsLinkGroup,
  SettingsLinkRow,
  type SettingsLink,
} from "../../components/settings/SettingsLinkRow.js";
import {
  SetupChecklist,
  setupSteps,
} from "../../components/SetupChecklist.js";
import { api } from "../../lib/api.js";
import { qk } from "../../lib/query-client.js";
import { useOrgQuery } from "../../lib/use-api.js";
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
        description: "The accounts your mail goes out as.",
      },
      {
        to: "/settings/sending/health",
        title: "Sending health",
        description:
          "Bounces, complaints, and how each recipient domain treats you.",
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
    // Install scope, not organization scope. The whole group disappears for
    // everyone who isn't an instance administrator, since empty groups drop out
    // below — which is most people, on most instances.
    heading: "This server",
    links: [
      {
        to: "/settings/instance",
        title: "Instance",
        description: "Server-wide settings and configuration health.",
        instanceAdminOnly: true,
      },
      {
        to: "/settings/instance/organizations",
        title: "Organizations",
        description: "Every organization on this server, and who is in them.",
        instanceAdminOnly: true,
      },
      {
        to: "/settings/instance/domains",
        title: "Domains",
        description:
          "The mail server everyone shares, and which organization holds each domain.",
        instanceAdminOnly: true,
      },
      {
        to: "/settings/instance/mailboxes",
        title: "All mailboxes",
        description: "Every mailbox on the mail server, across organizations.",
        instanceAdminOnly: true,
      },
    ],
  },
  {
    heading: "Advanced",
    links: [
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
  const { currentOrganization, currentOrganizationId } = useSession();
  const { isInstanceAdmin } = useInstanceAdmin();

  /*
    The dashboard used to carry a permanent "3/4 ready" card. It came off that
    screen because a checklist you finished months ago is not news forty times a
    day — but "is this org actually set up?" is still a question, and this is
    where you come to ask it. Same query key as the dashboard's, so the answer
    is already cached by the time anyone opens Settings.
  */
  const summaryQuery = useOrgQuery(
    currentOrganizationId,
    qk.dashboard(currentOrganizationId ?? ""),
    (id) => api.dashboardSummary(id),
    // Setup state is decoration on this page; the destinations below are the
    // content, and none of them need a toast to explain themselves.
    { meta: { silent: true } }
  );

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

      <PageContainer>
        {summaryQuery.data ? (
          <div className="mb-6">
            <SetupChecklist
              steps={setupSteps(summaryQuery.data.setup)}
              showWhenComplete
            />
          </div>
        ) : null}

        <nav aria-label="Settings sections" className="space-y-6">
          {visibleGroups.map((group) => (
            <SettingsLinkGroup key={group.heading} heading={group.heading}>
              {group.links.map((link) => (
                <SettingsLinkRow key={link.to} {...link} />
              ))}
            </SettingsLinkGroup>
          ))}
        </nav>
      </PageContainer>
    </>
  );
}
