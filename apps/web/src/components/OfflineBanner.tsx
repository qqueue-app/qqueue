import { WifiOff } from "lucide-react";
import { useOnline } from "../lib/use-online.js";

/**
 * The honest signal that the data on screen may be stale.
 *
 * §5 asks for a slim warning strip rather than a dead white screen, and the
 * service worker is built to make that possible: it precaches the app shell but
 * deliberately never caches `/api`, so offline the app still *opens* — it just
 * has nothing new to show. This is the one piece of UI that says so.
 *
 * It sits in the flow at the top of main rather than floating over it, so it
 * can never cover a page header, and sticks to `--shell-sticky-top` — the token
 * that already knows what is parked above it (the notch on a phone, the top bar
 * on a tablet) — so it stays visible while the page scrolls.
 */
export function OfflineBanner() {
  const online = useOnline();

  if (online) {
    return null;
  }

  return (
    <div
      /*
        `status`, not `alert`: losing signal is a condition worth mentioning at
        the next natural pause, not an emergency worth interrupting whatever a
        screen reader is currently saying.
      */
      role="status"
      aria-live="polite"
      className="sticky top-sticky-top z-30 flex items-center justify-center gap-2 border-b border-warn/20 bg-warn-bg px-4 py-field text-meta font-medium text-warn"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>You&rsquo;re offline — showing cached data</span>
    </div>
  );
}
