/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";
import { urlBase64ToUint8Array } from "./lib/push.js";
import { readPushConfig } from "./lib/push-config.js";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Take over as soon as a new build is installed. The dashboard is a single
// long-lived tab on a phone; waiting for every client to close would leave
// people on a stale bundle for days.
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// App-shell routing so an installed PWA opens offline instead of showing the
// browser's error page. API calls are deliberately *not* cached — stale mail
// is worse than an honest "you're offline".
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  })
);

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

function parsePayload(event: PushEvent): PushPayload {
  try {
    const data = event.data?.json() as Partial<PushPayload> | undefined;
    if (data?.title && data.body) {
      return {
        title: data.title,
        body: data.body,
        url: data.url,
        tag: data.tag,
      };
    }
  } catch {
    // Some push services send a keepalive with no body, and a malformed
    // payload should still surface *something* rather than nothing.
  }
  return { title: "QQueue", body: "You have new mail." };
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/images/android-chrome-192x192.png",
      badge: "/images/favicon-48x48.png",
      // Same tag replaces the existing banner instead of stacking a new one.
      // `renotify` is left at its default false, so a second reply on a thread
      // updates the banner silently rather than buzzing again.
      tag: payload.tag,
      data: { url: payload.url ?? "/inbox" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url;
  const url = target ?? "/inbox";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Reuse the already-open app rather than spawning a second copy — one of
      // the main things that makes a PWA feel unlike a native app.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(url).catch(() => undefined);
          }
          return;
        }
      }

      await self.clients.openWindow(url);
    })()
  );
});

/**
 * `pushsubscriptionchange` carries the two subscriptions on browsers that
 * implement the current spec; older ones fire a bare event and leave the worker
 * to resubscribe itself. TypeScript's worker lib still types this as a plain
 * Event, so the shape is spelled out here.
 */
interface SubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription?: PushSubscription | null;
  readonly newSubscription?: PushSubscription | null;
}

async function announceSubscriptionChange(): Promise<void> {
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clientList) {
    client.postMessage({ type: "qqueue:push-subscription-change" });
  }
}

/**
 * Repair the registration after the browser rotates it.
 *
 * Chrome rotates subscriptions on its own schedule, and almost always with no
 * tab open — so merely telling the clients, as this used to do, reached nobody.
 * Worse, the next time the app opened it saw a valid *local* subscription and
 * reported notifications as on, while the server still held the endpoint that
 * had been rotated away. The device was silent and the UI said it was fine.
 *
 * The fix has to run here, in the worker, with no session available: the rotate
 * endpoint authorizes on possession of the old endpoint instead.
 */
async function handleSubscriptionChange(
  event: SubscriptionChangeEvent
): Promise<void> {
  try {
    const oldEndpoint = event.oldSubscription?.endpoint;
    const config = await readPushConfig();

    let renewed = event.newSubscription ?? null;
    if (!renewed) {
      // Prefer the key the dead subscription was created with; fall back to the
      // one cached when notifications were switched on.
      const applicationServerKey =
        event.oldSubscription?.options?.applicationServerKey ??
        (config ? urlBase64ToUint8Array(config.vapidPublicKey) : null);
      if (applicationServerKey) {
        renewed = await self.registration.pushManager
          .subscribe({ userVisibleOnly: true, applicationServerKey })
          .catch(() => null);
      }
    }

    // Without the endpoint it replaced there is no way to say *which*
    // registration this renews, and no credential to say it with.
    if (renewed && oldEndpoint && config) {
      const json = renewed.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (json.endpoint && p256dh && auth) {
        await fetch(`${config.apiBaseUrl}/api/v1/push/subscriptions/rotate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            oldEndpoint,
            endpoint: json.endpoint,
            keys: { p256dh, auth },
          }),
        }).catch(() => undefined);
      }
    }
  } finally {
    // An open tab reconciles its toggle either way — including when the repair
    // failed, so the switch stops claiming to be on.
    await announceSubscriptionChange();
  }
}

self.addEventListener("pushsubscriptionchange", (event) => {
  const changeEvent = event as SubscriptionChangeEvent;
  changeEvent.waitUntil(handleSubscriptionChange(changeEvent));
});

export {};
