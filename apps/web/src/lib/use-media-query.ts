import { useEffect, useState } from "react";

/**
 * Track a CSS media query in React state.
 *
 * Used where a layout must *render* differently rather than merely look
 * different — hiding one of two trees with CSS leaves both in the DOM, which
 * makes screen readers announce everything twice and doubles the node count on
 * exactly the devices least able to afford it.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    // Guard for jsdom and any environment without matchMedia: falling back to
    // false means components render their desktop branch, which is the more
    // complete one.
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Re-read on mount: the query may have changed between the initial state
    // and this effect (a rotated phone, or a resized window during hydration).
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** True below Tailwind's `md` breakpoint — the app's phone/desktop dividing line. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
