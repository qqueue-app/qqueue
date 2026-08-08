import { useEffect, useState } from "react";

/**
 * Whether the browser currently believes it has a network.
 *
 * `navigator.onLine` is famously weak — it reports "online" for a captive
 * portal or a Wi-Fi network with no route out — so it is trusted in one
 * direction only. `false` is reliable (the OS knows there is no interface) and
 * is what drives the offline banner; `true` merely means it is worth trying,
 * which is why the draft queue also flushes on a failed request rather than
 * waiting for this to flip.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    // Re-read on mount: the events fire on `window`, and one can land between
    // the initial state above and this subscription.
    setOnline(navigator.onLine);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
