import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  Inbox,
  FileEdit,
  MailCheck,
  Send,
  Search,
  PenSquare,
  Users,
  List,
  FileText,
  Megaphone,
  Settings as SettingsIcon,
  X,
  Star,
  Archive,
  Trash2,
  ShieldAlert,
  Mails,
  Folder,
} from "lucide-react";
import { useUnreadCount } from "../lib/use-unread-count.js";
import { BrandWordmark } from "../components/BrandWordmark.js";
import { WindowDraftNotice } from "../components/WindowDraftNotice.js";
import { OfflineBanner } from "../components/OfflineBanner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet.js";
import { MailHeader } from "../components/shell/MailHeader.js";
import {
  ComposeHost,
  useMailComposeOpen,
} from "../components/mail/ComposeWorkspace.js";
import { useMediaQuery } from "../lib/use-media-query.js";
import { SidebarNav } from "../components/shell/SidebarNav.js";
import type { NavSection } from "../components/shell/nav-types.js";

// One destination table for the desktop navigation and the phone drawer.
// Daily mail stays visible; campaigns and reporting remain under More tools.
const navSections: NavSection[] = [
  {
    items: [
      // Daily mail comes first. The index route "/" is the inbox, so it
      // lights this destination up too.
      {
        to: "/inbox",
        label: "Inbox",
        icon: Inbox,
        badge: "unread",
        activePaths: ["/"],
      },
      { to: "/email-studio", label: "Compose", icon: PenSquare },
      { to: "/inbox?view=FLAGGED", label: "Starred", icon: Star },
      { to: "/search", label: "Search mail", icon: Search },
      { to: "/sent", label: "Sent", icon: MailCheck },
      { to: "/drafts", label: "Drafts", icon: FileEdit },
      { to: "/outbox", label: "Outbox", icon: Send },
      { to: "/inbox?view=ALL", label: "All mail", icon: Mails },
      { to: "/inbox?view=ARCHIVE", label: "Archive", icon: Archive },
      { to: "/inbox?view=JUNK", label: "Spam", icon: ShieldAlert },
      { to: "/inbox?view=TRASH", label: "Trash", icon: Trash2 },
      { to: "/inbox?view=OTHER", label: "Other folders", icon: Folder },
      // Statistics are useful, but this is a report rather than the mail home.
      {
        to: "/insights",
        label: "Insights",
        icon: BarChart3,
        end: true,
        advanced: true,
      },
    ],
  },
  {
    heading: "Audience",
    items: [
      { to: "/contacts", label: "Contacts", icon: Users, advanced: true },
      // Not `end`: the Smart tab lives at /campaigns/lists/smart and has to
      // keep this item lit.
      { to: "/campaigns/lists", label: "Lists", icon: List, advanced: true },
    ],
  },
  {
    heading: "Campaigns",
    items: [
      { to: "/templates", label: "Templates", icon: FileText, advanced: true },
      {
        to: "/campaigns",
        label: "Campaigns",
        advanced: true,
        icon: Megaphone,
        // `end`, or /campaigns/lists lights up Campaigns and Lists at once.
        end: true,
        /*
          Recurring sends are a tab of this destination, not a twelfth row —
          the sidebar is already ~690px tall and must never scroll (§2/§4). So
          it is named here instead, or the nav goes dark while you are standing
          on a page it owns.
        */
        activePaths: ["/campaigns/recurring"],
      },
    ],
  },
  {
    items: [
      {
        to: "/settings",
        label: "Settings",
        icon: SettingsIcon,
        /*
          Every settings destination now lives under /settings/*, so the default
          prefix match lights this item for all of them. Background jobs is the
          one exception — it kept its own top-level path — and has to be named
          here or the sidebar goes dark while you are looking at it.
        */
        activePaths: ["/queue-operations"],
      },
    ],
  },
];

/** Shared mail shell. The phone uses the folder drawer and a Compose action. */
export function DashboardLayout() {
  const unread = useUnreadCount();
  const composing = useMailComposeOpen();
  const location = useLocation();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navigationMounted, setNavigationMounted] = useState(false);
  const notices = useRef<HTMLDivElement>(null);
  const [noticeHeight, setNoticeHeight] = useState(0);
  useLayoutEffect(() => {
    const measured = () =>
      setNoticeHeight(notices.current?.getBoundingClientRect().height ?? 0);
    measured();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measured);
    if (notices.current) observer?.observe(notices.current);
    window.addEventListener("resize", measured);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measured);
    };
  }, []);
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search, composing, desktop]);
  return (
    <div
      className="mail-shell min-h-screen bg-bg"
      data-collapsed={collapsed || undefined}
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-4 py-2 text-body focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <MailHeader
        onMenu={() => {
          if (desktop) setCollapsed(!collapsed);
          else {
            setNavigationMounted(true);
            setDrawerOpen(true);
          }
        }}
      />
      <aside className="mail-sidebar fixed left-0 z-30 hidden w-sidebar flex-col pb-safe-b pl-safe-l lg:flex">
        <SidebarNav sections={navSections} unread={unread} showBrand={false} />
      </aside>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          hideClose
          onCloseAutoFocus={(event) => {
            if (composing) event.preventDefault();
            setNavigationMounted(false);
          }}
          aria-describedby={undefined}
          className="mail-navigation-drawer w-sidebar max-w-none gap-0 p-0 pb-safe-b pl-safe-l pt-safe-t"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-16 shrink-0 items-center justify-between px-4">
            <BrandWordmark />
            <IconButton
              label="Close navigation"
              onClick={() => setDrawerOpen(false)}
            >
              <X />
            </IconButton>
          </div>
          <SidebarNav
            sections={navSections}
            unread={unread}
            showBrand={false}
          />
        </SheetContent>
      </Sheet>
      <main
        id="main"
        style={{ "--mail-notice-height": `${noticeHeight}px` } as CSSProperties}
        tabIndex={-1}
        className="mail-main min-w-0 pb-safe-b pl-safe-l pr-safe-r pt-safe-t focus:outline-none sm:pb-0 lg:pl-sidebar"
      >
        <div className="mail-main-surface">
          <div ref={notices}>
            <OfflineBanner />
            <WindowDraftNotice />
          </div>
          <Suspense
            fallback={
              <div className="space-y-3 p-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-64" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>
      <Link to="/email-studio" className="mail-mobile-compose sm:hidden">
        <PenSquare className="h-6 w-6" />
        Compose
      </Link>
      <ComposeHost navigationBlocking={navigationMounted} />
    </div>
  );
}
