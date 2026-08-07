import { useEffect, useRef } from "react";

/**
 * Fade whichever edge of a horizontally scrolling strip has more content past
 * it, so "there is more here" is visible rather than guessed at.
 *
 * A swipeable toolbar's one real weakness is that the controls off-screen leave
 * no trace — a row that ends flush at the viewport edge looks like a row that
 * ended. This drives two custom properties the `.qq-toolbar-scroller` rule
 * turns into a mask, and it drives them from the *actual* scroll position, so
 * the last button doesn't sit permanently half-faded once you reach the end.
 *
 * Returns a ref to attach to the scrolling element.
 */
export function useOverflowFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    function update() {
      const el = ref.current;
      if (!el) return;
      // 1px of slack: fractional scroll positions mean scrollLeft rarely lands
      // exactly on 0 or on the maximum, and a permanently-on fade at a hard
      // stop is precisely the artefact this exists to avoid.
      const max = el.scrollWidth - el.clientWidth;
      el.style.setProperty("--fade-start", el.scrollLeft > 1 ? "1.5rem" : "0px");
      el.style.setProperty(
        "--fade-end",
        el.scrollLeft < max - 1 ? "1.5rem" : "0px"
      );
    }

    update();
    element.addEventListener("scroll", update, { passive: true });

    // The element's own box changes on rotate and on breakpoint crossings…
    const resize = new ResizeObserver(update);
    resize.observe(element);
    // …and its *content* width changes when the toolbar grows a control, which
    // it does: selecting a table adds "Add row" and "Add column".
    const mutate = new MutationObserver(update);
    mutate.observe(element, { childList: true, subtree: true });

    return () => {
      element.removeEventListener("scroll", update);
      resize.disconnect();
      mutate.disconnect();
    };
  }, []);

  return ref;
}
