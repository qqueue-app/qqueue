/**
 * Web Push plumbing for the installable dashboard.
 *
 * Three pieces of state have to agree before a notification can arrive: the
 * browser's permission, a PushSubscription on the service-worker registration,
 * and a row on our server. Any one of them can change without the others
 * knowing — a person can revoke permission in browser settings, Chrome rotates
 * subscriptions on its own, and clearing site data wipes the registration while
 * our row survives. Everything here exists to reconcile those three.
 */

/**
 * Push services want the VAPID key as a Uint8Array, not the base64url string.
 * Deliberately uses the bare `atob` rather than `window.atob`: the service
 * worker calls this too when it re-subscribes after a rotation, and there is no
 * `window` in worker scope.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  // Backed by a plain ArrayBuffer rather than the default ArrayBufferLike, so
  // it satisfies BufferSource where `pushManager.subscribe` expects it.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: string };

/**
 * Whether this browser can do Web Push at all, with a reason a non-technical
 * person can act on. iOS is the case that actually bites: Safari only exposes
 * push to a PWA installed on the home screen, so a plain Safari tab reports
 * unsupported no matter what the user does in settings.
 */
export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Not running in a browser." };
  }
  if (!("serviceWorker" in navigator)) {
    return {
      supported: false,
      reason: "This browser doesn't support background notifications.",
    };
  }
  if (!("PushManager" in window)) {
    if (isIos() && !isStandalone()) {
      return {
        supported: false,
        reason:
          "On iPhone and iPad, add QQueue to your Home Screen first — Safari only allows notifications for installed apps.",
      };
    }
    return {
      supported: false,
      reason: "This browser doesn't support push notifications.",
    };
  }
  if (!("Notification" in window)) {
    return {
      supported: false,
      reason: "This browser doesn't support notifications.",
    };
  }
  return { supported: true };
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports as a Mac; the touch-point check is the usual way to tell it
  // apart from a desktop Safari that genuinely does support push.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * True when running as an installed app rather than in a browser tab.
 *
 * All three installed display modes count, not just the `standalone` the
 * manifest asks for: a desktop install can end up in `window-controls-overlay`,
 * and a launcher can honour `minimal-ui` instead. Each of them means the same
 * thing to a caller — there is no browser chrome and no install left to offer.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia(
      "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)"
    ).matches ||
    // Safari's non-standard flag, still the only signal on iOS.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** A short, human label for the current device, shown in the device list. */
export function describeDevice(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : "Browser";
  const platform = /android/i.test(ua)
    ? "Android"
    : isIos()
      ? "iOS"
      : /mac/i.test(ua)
        ? "macOS"
        : /win/i.test(ua)
          ? "Windows"
          : /linux/i.test(ua)
            ? "Linux"
            : "device";
  return `${browser} on ${platform}${isStandalone() ? " (installed)" : ""}`;
}

/**
 * The service worker registration, once it is actually controlling the page.
 * `navigator.serviceWorker.ready` is what guarantees that — asking for a push
 * subscription before it resolves fails intermittently on first load.
 */
export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Ask the browser to create a subscription. Returns null when the person
 * declines — a refusal is an answer, not an error, and must not surface as one.
 */
export async function createSubscription(
  vapidPublicKey: string
): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  if (!registration) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  return registration.pushManager.subscribe({
    // Required by every current implementation: a push must always be shown to
    // the user, never used for silent background work.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export interface SerializedSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Flatten a browser PushSubscription into the shape our API stores. Returns
 * null if either key is missing, which happens on a subscription that was
 * created before a permission reset and is no longer usable.
 */
export function serializeSubscription(
  subscription: PushSubscription
): SerializedSubscription | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}
