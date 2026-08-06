import { Bell, BellOff, Info } from "lucide-react";
import { Button } from "./ui/button.js";
import { Card, CardContent } from "./ui/card.js";
import { Spinner } from "./ui/spinner.js";
import { usePushNotifications } from "../lib/use-push-notifications.js";

/**
 * The per-device notification toggle. Deliberately says "this device": push
 * subscriptions are per browser install, so turning it on at a desk does
 * nothing for the phone in someone's pocket, and pretending otherwise is how
 * people end up believing notifications are broken.
 */
export function NotificationsCard() {
  const { status, reason, busy, enable, disable } = usePushNotifications();

  if (status === "loading") {
    return null;
  }

  const on = status === "on";
  const actionable = status === "on" || status === "off";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            on
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {on ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            New mail alerts on this device
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {on
              ? "You'll get an alert when a reply arrives, even when QQueue is closed."
              : (reason ??
                "Get an alert when a reply lands in your inbox, even when QQueue is closed.")}
          </p>
          {reason && on ? null : null}
        </div>

        {actionable ? (
          <Button
            variant={on ? "outline" : "default"}
            onClick={() => (on ? disable() : enable())}
            disabled={busy}
            className="shrink-0"
          >
            {busy ? <Spinner /> : on ? <BellOff /> : <Bell />}
            {on ? "Turn off" : "Turn on"}
          </Button>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Unavailable
          </span>
        )}
      </CardContent>
    </Card>
  );
}
