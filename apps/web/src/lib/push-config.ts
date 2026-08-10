/**
 * The little bit of state a service worker needs in order to repair itself.
 *
 * When a browser rotates a push subscription it fires `pushsubscriptionchange`
 * at the service worker, usually with no tab open. To re-register, the worker
 * needs the VAPID public key (to resubscribe) and the API's base URL (to tell
 * us about it) — neither of which it can reach: `import.meta.env` is baked into
 * the app bundle, and the access token lives in localStorage, which workers
 * cannot read at all.
 *
 * So the app hands both over at the moment notifications are turned on, through
 * the Cache API: the one storage both a window and a worker can open, and a
 * great deal less machinery than IndexedDB for a single record.
 */

const CACHE_NAME = "qqueue-push-config";
const CONFIG_URL = "/__qqueue/push-config";

export interface PushConfig {
  vapidPublicKey: string;
  /** May be an empty string, meaning same-origin relative requests. */
  apiBaseUrl: string;
}

/**
 * Every operation here is best-effort. Storage can be denied outright (Safari
 * private browsing, a locked-down enterprise profile), and losing this cache
 * costs a device its automatic re-registration — not its notifications, which
 * keep working until the browser next rotates the subscription.
 */
export async function savePushConfig(config: PushConfig): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      CONFIG_URL,
      new Response(JSON.stringify(config), {
        headers: { "content-type": "application/json" },
      })
    );
  } catch {
    // Nothing to do and nobody to tell: this runs inside enabling
    // notifications, which has otherwise succeeded.
  }
}

export async function readPushConfig(): Promise<PushConfig | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(CONFIG_URL);
    if (!response) return null;
    const config = (await response.json()) as Partial<PushConfig>;
    if (typeof config.vapidPublicKey !== "string" || !config.vapidPublicKey) {
      return null;
    }
    return {
      vapidPublicKey: config.vapidPublicKey,
      apiBaseUrl:
        typeof config.apiBaseUrl === "string" ? config.apiBaseUrl : "",
    };
  } catch {
    return null;
  }
}

export async function clearPushConfig(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Same as above — turning notifications off has already succeeded.
  }
}
