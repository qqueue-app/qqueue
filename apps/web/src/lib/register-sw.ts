import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

/**
 * Register the service worker that backs offline start-up and push
 * notifications.
 *
 * Updates are offered, not forced: reloading out from under someone who is
 * halfway through composing an email would lose their draft. The prompt is a
 * toast they can ignore, and the new build takes over on the next natural load
 * regardless.
 */
export function registerServiceWorker() {
  if (import.meta.env.MODE === "test") return;

  const updateSW = registerSW({
    onNeedRefresh() {
      toast("A new version of QQueue is available.", {
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            void updateSW(true);
          },
        },
      });
    },
    onOfflineReady() {
      // Silent by design: nobody asked for this, and a toast on first load
      // announcing a technical capability is noise.
    },
  });
}
