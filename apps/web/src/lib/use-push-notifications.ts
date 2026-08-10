import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiBaseUrl } from "./api.js";
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
import { clearPushConfig, savePushConfig } from "./push-config.js";

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
 *
 * All three have to agree before the switch may read "on". Checking only the
 * browser, as this once did, made the toggle lie in the one case that matters:
 * after the browser rotates a subscription there is a perfectly valid local
 * registration whose endpoint the server has never heard of, and the device is
 * silent while the settings page insists it is fine.
 */
export function usePushNotifications(): UsePushNotifications {
  const queryClient = useQueryClient();
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
    if (!existing) {
      setSubscribed(false);
      return;
    }
    // The local registration exists — now confirm the server knows this exact
    // endpoint, since that is what decides whether anything ever arrives.
    try {
      const devices = await queryClient.fetchQuery({
        queryKey: qk.pushDevices(),
        queryFn: () => api.listPushSubscriptions(),
        staleTime: 0,
      });
      setSubscribed(devices.some((device) => device.endpoint === existing.endpoint));
    } catch {
      // The server is unreachable or the session has expired. Both are about
      // this request, not about the subscription — leave the last known answer
      // rather than reporting a device switched off that probably isn't.
      setSubscribed((previous) => previous ?? true);
    }
  }, [support.supported, queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Chrome rotates subscriptions on its own schedule; the service worker
  // re-registers and then tells us, so the toggle reflects the repair (or its
  // failure) without a reload.
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
    if (!keyInfo?.publicKey) return;
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
        ...serialized,
        userAgent: describeDevice(),
      });
      // Hand the worker what it needs to re-register itself later; it can read
      // neither the app's env nor the session token.
      await savePushConfig({
        vapidPublicKey: keyInfo.publicKey,
        apiBaseUrl,
      });
      await queryClient.invalidateQueries({ queryKey: qk.pushDevices() });
      setSubscribed(true);
      toast.success("Notifications are on for this device.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't turn on notifications."));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [keyInfo?.publicKey, refresh, queryClient]);

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
      await clearPushConfig();
      await queryClient.invalidateQueries({ queryKey: qk.pushDevices() });
      setSubscribed(false);
      toast.success("Notifications are off for this device.");
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't turn off notifications."));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, queryClient]);

  return { status, reason, busy, enable, disable };
}

/**
 * The other half of the answer: a device is *yours*, but how much of a given
 * organization's mail may reach it is a preference that follows you onto every
 * device you own. Kept separate from the toggle above because it is server
 * state about an org, not browser state about this install.
 */
export function useInboxNotifyPreference() {
  const { currentOrganizationId } = useSession();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: qk.inboxNotifyPreference(currentOrganizationId ?? ""),
    queryFn: () => api.inboxNotifyPreference(currentOrganizationId!),
    enabled: Boolean(currentOrganizationId),
  });

  const setLevel = useCallback(
    async (notifyLevel: "ALL" | "ADDRESSED_TO_ME" | "NONE") => {
      if (!currentOrganizationId) return;
      setSaving(true);
      try {
        await api.updateInboxNotifyPreference({
          organizationId: currentOrganizationId,
          notifyLevel,
        });
        await queryClient.invalidateQueries({
          queryKey: qk.inboxNotifyPreference(currentOrganizationId),
        });
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't save that preference."));
      } finally {
        setSaving(false);
      }
    },
    [currentOrganizationId, queryClient]
  );

  return {
    level: data?.notifyLevel ?? "ALL",
    isPending: isPending && Boolean(currentOrganizationId),
    saving,
    setLevel,
  };
}
