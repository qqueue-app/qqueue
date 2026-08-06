/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";

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

// Chrome rotates subscriptions periodically. Without this the device goes
// quiet with no visible cause; telling the app lets it re-register.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        client.postMessage({ type: "qqueue:push-subscription-change" });
      }
    })()
  );
});

export {};
