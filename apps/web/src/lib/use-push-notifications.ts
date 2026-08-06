import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "./api.js";
import { qk } from "./query-client.js";
import { errorMessage } from "./use-api.js";
import { useSession } from "./session-context.js";
import {
  createSubscription,
  describeDevice,
  detectPushSupport,
  getExistingSubscription,
  serializeSubscription,
} from "./push.js";

export type PushStatus =
  /** The instance has no VAPID pair — nothing to offer. */
  | "unavailable"
  /** This browser can't do push (see `reason`). */
  | "unsupported"
  /** Available, not turned on. */
  | "off"
  /** Turned on for this device. */
  | "on"
  /** Permission was denied at the browser level; we can't re-prompt. */
  | "blocked"
  | "loading";

export interface UsePushNotifications {
  status: PushStatus;
  /** Why push is unsupported or blocked, phrased for a non-technical reader. */
  reason: string | null;
  busy: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

/**
 * Owns the "notify me about new mail on this device" toggle.
 *
 * Enabling is a three-step handshake — browser permission, a subscription on
 * the service worker, then a row on our server — and any step can already be
 * done from a previous session, so this reconciles rather than assumes.
 */
export function usePushNotifications(): UsePushNotifications {
  const { currentOrganizationId } = useSession();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const support = detectPushSupport();

  const { data: keyInfo, isPending: keyPending } = useQuery({
    queryKey: qk.pushPublicKey(),
    queryFn: () => api.pushPublicKey(),
    // A VAPID pair is instance configuration; it does not change while the tab
    // is open, so this never needs refetching.
    staleTime: Infinity,
    enabled: support.supported,
    retry: false,
  });

  const refresh = useCallback(async () => {
    if (!support.supported) {
      setSubscribed(false);
      return;
    }
    const existing = await getExistingSubscription();
    setSubscribed(existing !== null);
  }, [support.supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Chrome rotates subscriptions on its own schedule; the service worker tells
  // us so the device doesn't silently stop receiving mail alerts.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      if (event.data?.type === "qqueue:push-subscription-change") {
        void refresh();
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [refresh]);

  const permission =
    typeof Notification !== "undefined" ? Notification.permission : "default";

  const status: PushStatus = !support.supported
    ? "unsupported"
    : keyPending || subscribed === null
      ? "loading"
      : !keyInfo?.enabled || !keyInfo.publicKey
        ? "unavailable"
        : permission === "denied"
          ? "blocked"
          : subscribed
            ? "on"
            : "off";

  const reason = !support.supported
    ? support.reason
    : status === "blocked"
      ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again."
      : status === "unavailable"
        ? "This QQueue instance hasn't been set up for notifications yet. An administrator needs to add VAPID keys."
        : null;

  const enable = useCallback(async () => {
    if (!keyInfo?.publicKey || !currentOrganizationId) return;
    setBusy(true);
    try {
      const subscription = await createSubscription(keyInfo.publicKey);
      if (!subscription) {
        // Declining the browser prompt is a choice, not a failure.
        await refresh();
        return;
      }
      const serialized = serializeSubscription(subscription);
      if (!serialized) {
        throw new Error("This browser returned an unusable subscription.");
      }
      await api.subscribeToPush({
        organizationId: currentOrganizationId,
        ...serialized,
        userAgent: describeDevice(),
      });
      setSubscribed(true);
      toast.success("Notifications are on for this device.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't turn on notifications."));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [keyInfo?.publicKey, currentOrganizationId, refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const existing = await getExistingSubscription();
      if (existing) {
        // Tell the server first: if unsubscribing locally succeeded but the
        // server call failed, we'd keep pushing to a dead endpoint until the
        // push service 410s it.
        await api.unsubscribeFromPush(existing.endpoint).catch(() => undefined);
        await existing.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notifications are off for this device.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't turn off notifications."));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { status, reason, busy, enable, disable };
}
