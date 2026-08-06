import {
  BarChart3,
  Ban,
  FileEdit,
  FileText,
  Inbox,
  KeyRound,
  List,
  Mail,
  Megaphone,
  PenSquare,
  Send,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavLeaf {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Short help shown as a tooltip on the collapsed rail and in the More sheet. */
  hint: string;
  /** Force exact-match active styling (NavLink `end`). */
  end?: boolean;
  adminOnly?: boolean;
  /** Show the unread-mail count on this item. */
  badge?: "unread";
}

export interface NavSection {
  heading?: string;
  items: NavLeaf[];
}

/**
 * The app's information architecture, in one place so the desktop sidebar, the
 * mobile bottom bar, and the More sheet can never drift apart.
 *
 * Ordered by what people do most, not by how the system is built: mail first,
 * the people you mail second, campaigns third, and the machinery
 * (sending accounts, deliverability, queues) last under Settings.
 */
export const navSections: NavSection[] = [
  {
    heading: "Mail",
    items: [
      {
        to: "/inbox",
        label: "Inbox",
        icon: Inbox,
        hint: "Replies and mail received by your team",
        badge: "unread",
      },
      {
        to: "/email-studio",
        label: "Compose",
        icon: PenSquare,
        hint: "Write and send an email",
      },
      {
        to: "/drafts",
        label: "Drafts",
        icon: FileEdit,
        hint: "Emails you started but haven't sent",
      },
      {
        to: "/outbox",
        label: "Outbox",
        icon: Send,
        hint: "Mail waiting to go out — cancel it here",
      },
    ],
  },
  {
    heading: "People",
    items: [
      {
        to: "/contacts",
        label: "Contacts",
        icon: Users,
        hint: "Everyone you can email",
      },
      {
        to: "/campaigns/lists",
        label: "Lists",
        icon: List,
        hint: "Groups you add people to by hand",
        end: true,
      },
      {
        to: "/campaigns/segments",
        label: "Smart lists",
        icon: Sparkles,
        hint: "Groups that fill themselves from rules",
        end: true,
      },
    ],
  },
  {
    heading: "Campaigns",
    items: [
      {
        to: "/campaigns",
        label: "Campaigns",
        icon: Megaphone,
        hint: "Send one email to a whole list",
        end: true,
      },
      {
        to: "/templates",
        label: "Templates",
        icon: FileText,
        hint: "Reusable email designs",
      },
      {
        to: "/insights",
        label: "Insights",
        icon: BarChart3,
        hint: "How your sending is performing",
      },
    ],
  },
  {
    heading: "Setup",
    items: [
      {
        to: "/smtp-connections",
        label: "Sending accounts",
        icon: Server,
        hint: "The addresses QQueue sends from",
      },
      {
        to: "/mailboxes",
        label: "Mailboxes",
        icon: Mail,
        hint: "Create team mailboxes and control who sends as them",
        adminOnly: true,
      },
      {
        to: "/deliverability",
        label: "Sending health",
        icon: ShieldCheck,
        hint: "Whether your mail is actually landing",
      },
      {
        to: "/suppressions",
        label: "Blocked addresses",
        icon: Ban,
        hint: "People QQueue will never email again",
      },
      {
        to: "/queue-operations",
        label: "Background jobs",
        icon: KeyRound,
        hint: "The job queue, for when something looks stuck",
        adminOnly: true,
      },
      {
        to: "/settings",
        label: "Settings",
        icon: SettingsIcon,
        hint: "Your organization, team, and API keys",
      },
    ],
  },
];

/**
 * The four destinations on the mobile bottom bar. Deliberately short: a phone
 * tab bar with more than five targets is a menu, not a tab bar. Everything else
 * lives one tap away behind More.
 */
export const mobileTabs: NavLeaf[] = [
  {
    to: "/inbox",
    label: "Inbox",
    icon: Inbox,
    hint: "Replies and mail received by your team",
    badge: "unread",
  },
  {
    to: "/contacts",
    label: "Contacts",
    icon: Users,
    hint: "Everyone you can email",
  },
  {
    to: "/campaigns",
    label: "Campaigns",
    icon: Megaphone,
    hint: "Send one email to a whole list",
    end: true,
  },
];

export function visibleSections(isOrgAdmin: boolean): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || isOrgAdmin),
    }))
    .filter((section) => section.items.length > 0);
}
