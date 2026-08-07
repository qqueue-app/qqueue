import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.js";
import { useOverflowFade } from "./use-overflow-fade.js";

/**
 * jsdom has no layout engine, so the scroll geometry is stubbed. That is the
 * whole input to this hook — it reads three numbers and writes two custom
 * properties — so stubbing them tests the real decision rather than a mock.
 */
function Strip({
  scrollWidth,
  clientWidth,
  scrollLeft,
}: {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}) {
  const ref = useOverflowFade<HTMLDivElement>();
  return (
    <div
      data-testid="strip"
      ref={(node) => {
        if (node) {
          Object.defineProperty(node, "scrollWidth", {
            configurable: true,
            get: () => scrollWidth,
          });
          Object.defineProperty(node, "clientWidth", {
            configurable: true,
            get: () => clientWidth,
          });
          Object.defineProperty(node, "scrollLeft", {
            configurable: true,
            get: () => scrollLeft,
          });
        }
        ref.current = node;
      }}
    />
  );
}

function fades(scrollWidth: number, clientWidth: number, scrollLeft: number) {
  // Scoped to this render's own container: cleanup runs per test, not per
  // call, so a test that measures two positions has two strips on the page.
  const { container } = renderWithProviders(
    <Strip
      scrollWidth={scrollWidth}
      clientWidth={clientWidth}
      scrollLeft={scrollLeft}
    />
  );
  const strip = container.querySelector<HTMLElement>('[data-testid="strip"]')!;
  act(() => {
    strip.dispatchEvent(new Event("scroll"));
  });
  return {
    start: strip.style.getPropertyValue("--fade-start"),
    end: strip.style.getPropertyValue("--fade-end"),
  };
}

describe("useOverflowFade (§5 swipe toolbar)", () => {
  it("fades only the trailing edge at rest", () => {
    // Parked at the start with plenty to the right: nothing is hidden behind
    // the left edge yet, so fading it would be a lie about the first control.
    expect(fades(1100, 341, 0)).toEqual({ start: "0px", end: "1.5rem" });
  });

  it("fades both edges mid-scroll", () => {
    expect(fades(1100, 341, 380)).toEqual({ start: "1.5rem", end: "1.5rem" });
  });

  it("fades only the leading edge at the end", () => {
    // The last button must come fully opaque, or a reachable control looks
    // permanently disabled.
    expect(fades(1100, 341, 759)).toEqual({ start: "1.5rem", end: "0px" });
  });

  it("fades neither edge when everything already fits", () => {
    // The desktop toolbar wraps instead of scrolling; a mask there would dim
    // the first and last button of a row for no reason.
    expect(fades(341, 341, 0)).toEqual({ start: "0px", end: "0px" });
  });

  it("treats a sub-pixel scroll position as a hard stop", () => {
    // Fractional scroll offsets mean scrollLeft rarely lands exactly on the
    // maximum; without the 1px slack the trailing fade would stick on forever.
    expect(fades(1100, 341, 758.6).end).toBe("0px");
    expect(fades(1100, 341, 0.4).start).toBe("0px");
  });
});
