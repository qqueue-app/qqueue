import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  Home,
  Inbox,
  FileEdit,
  Send,
  PenSquare,
  Users,
  List,
  FileText,
  Megaphone,
  Settings as SettingsIcon,
  Menu,
  X,
} from "lucide-react";
import { useUnreadCount } from "../lib/use-unread-count.js";
import { BrandWordmark } from "../components/BrandWordmark.js";
import { DashboardSplash } from "../components/DashboardSplash.js";
import { OfflineBanner } from "../components/OfflineBanner.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet.js";
import { MobileTabBar } from "../components/shell/MobileTabBar.js";
import { MoreSheet } from "../components/shell/MoreSheet.js";
import { SidebarNav } from "../components/shell/SidebarNav.js";
import type { MobileTab, NavSection } from "../components/shell/nav-types.js";

/*
  Every destination in the app, in one table.

  §4 of the design system restructured this and the shape matters as much as
  the contents: it is flat. The Settings sub-tree that used to hang off the
  bottom is a single item now, backed by a hub page, and "Smart lists" folded
  into Lists as a tab because smart is a *kind* of list, not a place to go.
  Both changes exist to keep this list short enough that the sidebar never
  needs a scrollbar of its own — so think twice before adding a tenth item, and
  three times before adding a sub-tree.
*/
const navSections: NavSection[] = [
  {
    items: [
      // Signing in lands on the inbox; the stats page it used to open is at
      // /insights. Same destination, new path.
      { to: "/insights", label: "Home", icon: Home, end: true },
      { to: "/email-studio", label: "Compose", icon: PenSquare },
      { to: "/drafts", label: "Drafts", icon: FileEdit },
      { to: "/outbox", label: "Outbox", icon: Send },
      // The index route "/" *is* the inbox, so it lights this up too.
      { to: "/inbox", label: "Inbox", icon: Inbox, badge: "unread", activePaths: ["/"] },
    ],
  },
  {
    heading: "Audience",
    items: [
      { to: "/contacts", label: "Contacts", icon: Users },
      // Not `end`: the Smart tab lives at /campaigns/lists/smart and has to
      // keep this item lit.
      { to: "/campaigns/lists", label: "Lists", icon: List },
    ],
  },
  {
    heading: "Campaigns",
    items: [
      { to: "/templates", label: "Templates", icon: FileText },
      {
        to: "/campaigns",
        label: "Campaigns",
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

/*
  The phone's tab bar: the four destinations worth a permanent thumb-reachable
  slot, plus a More tab the bar renders itself. Everything else lives in the
  More sheet, which reads the table above — so a destination added there shows
  up on a phone without a second edit here.
*/
const mobileTabs: MobileTab[] = [
  { to: "/insights", label: "Home", icon: Home, end: true },
  { to: "/email-studio", label: "Compose", icon: PenSquare, emphasis: true },
  { to: "/inbox", label: "Inbox", icon: Inbox, badge: "unread", activePaths: ["/"] },
  { to: "/contacts", label: "Contacts", icon: Users },
];

const tabBarPaths = mobileTabs.map((tab) => tab.to);

const SPLASH_STORAGE_KEY = "qqueue.dashboard-splash-seen";
const SPLASH_DURATION_MS = 3000;

/**
 * The app shell.
 *
 * Three layouts off two breakpoints, built mobile-first (§2):
 *
 *   <640px    no sidebar; a bottom tab bar plus a full-screen More sheet
 *   640–1023  a top bar whose menu button opens the sidebar as a drawer
 *   ≥1024px   the sidebar, fixed at 240px, always there
 *
 * **The document is the only scroll container at every one of them.** Nothing
 * in here sets `overflow`, and nothing sets a height that would make it need
 * to: the sidebar is fixed and short enough to fit, main flows, and the page
 * scrolls. The overlays (drawer, More sheet) scroll inside themselves, which is
 * allowed precisely because Radix freezes the document while they are open —
 * so there is still only ever one scrollbar on screen.
 */
export function DashboardLayout() {
  const unread = useUnreadCount();
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Close both nav overlays whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
    setMoreOpen(false);
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

  return (
    <div className="min-h-screen bg-bg">
      {showSplash ? <DashboardSplash /> : null}

      {/*
        Skip link.

        The sidebar is eleven destinations, three legal links and the account
        button — fifteen tab stops that a keyboard user crossed before reaching
        the page on *every* navigation, because the nav precedes main in the
        document (which is the right order for it to be in). This is the
        standard way out of that, and it is the only element in the shell that
        is deliberately invisible until focused: off-screen by default, and it
        lands in the top-left corner the moment it is tabbed to.
      */}
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-4 py-2 text-body font-medium text-text shadow-overlay focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      {/*
        Paints the strip behind the status bar in standalone, so content
        scrolling up past a sticky header isn't visible in the notch. Collapses
        to zero height anywhere `--safe-top` is 0, which is everywhere else.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-40 h-safe-t bg-bg"
      />

      {/* ---------------------------------------------------- desktop sidebar */}
      {/*
        `fixed` with no `overflow`: it can't scroll, by construction. Main is
        inset by the same token that sets this width so the two can't drift.
      */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-border bg-surface pb-safe-b pl-safe-l pt-safe-t lg:flex">
        <SidebarNav sections={navSections} unread={unread} />
      </aside>

      {/* -------------------------------------------------------- tablet bar */}
      <header className="sticky top-0 z-30 hidden h-topbar-safe items-center gap-2 border-b border-border bg-surface px-3 pt-safe-t sm:flex lg:hidden">
        <IconButton
          label="Open navigation"
          onClick={() => setDrawerOpen(true)}
          size="lg"
        >
          <Menu />
        </IconButton>
        <BrandWordmark />
      </header>

      {/* ----------------------------------------------------- tablet drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          hideClose
          aria-describedby={undefined}
          className="w-sidebar max-w-none gap-0 p-0 pb-safe-b pl-safe-l pt-safe-t lg:hidden"
        >
          {/* The wordmark below is a logo, not a heading — Radix still needs a
              real title for screen readers to announce the drawer. */}
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-14 shrink-0 items-center justify-between px-4">
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

      {/* ----------------------------------------------------------- content */}
      {/*
        Top inset is main's job only where nothing else is holding that space:
        in the tablet band the sticky bar above already occupies it.
        Bottom inset clears the tab bar and the home indicator under it.
      */}
      {/* `tabIndex={-1}` so the skip link above can actually move focus here:
          without it the browser scrolls to main but focus stays on the link,
          and the next Tab goes back into the nav. */}
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 pb-tabbar-safe pl-safe-l pr-safe-r pt-safe-t focus:outline-none sm:pb-0 sm:pt-0 lg:pl-sidebar lg:pt-safe-t"
      >
        {/* Above the routed page, so it can never cover a page header — and
            inside main, so it clears the sidebar on desktop. */}
        <OfflineBanner />
        <Outlet />
      </main>

      {/* ------------------------------------------------------- mobile nav */}
      <MobileTabBar
        tabs={mobileTabs}
        unread={unread}
        moreOpen={moreOpen}
        onOpenMore={() => setMoreOpen(true)}
      />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        sections={navSections}
        excludePaths={tabBarPaths}
        unread={unread}
      />
    </div>
  );
}
