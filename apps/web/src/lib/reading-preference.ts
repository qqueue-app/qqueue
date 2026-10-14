import { useSyncExternalStore } from "react";

export type ReadingPreference = "pane" | "focused";
const eventName = "qqueue-reading-preference";
function key(userId: string) {
  return `qqueue.reading.${userId}`;
}
export function readingPreference(userId: string): ReadingPreference {
  try {
    return localStorage.getItem(key(userId)) === "focused" ? "focused" : "pane";
  } catch {
    return "pane";
  }
}
export function setReadingPreference(userId: string, value: ReadingPreference) {
  try {
    localStorage.setItem(key(userId), value);
  } catch {
    /* Use the default if device storage is unavailable. */
  }
  window.dispatchEvent(new Event(eventName));
}
export function useReadingPreference(userId: string) {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener(eventName, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(eventName, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => readingPreference(userId),
    () => "pane" as const
  );
}
