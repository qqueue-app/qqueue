import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// --- jsdom polyfills for Radix UI (dialog, select, dropdown-menu, etc.) ---
// jsdom does not implement these APIs that Radix relies on.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserver as unknown as typeof globalThis.ResizeObserver;
}

/*
  A plain function, deliberately not a `vi.fn()`.

  This is a polyfill for an API jsdom doesn't implement, not a mock anyone
  asserts on — and as a `vi.fn()` it was fragile in a way that took a while to
  see: any suite calling `vi.restoreAllMocks()` in an `afterEach` wiped its
  implementation, so from the second test onward `matchMedia()` returned
  `undefined` and every component reading a media query threw. Nothing noticed
  while only a handful of components did.
*/
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = vi.fn();
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = vi.fn();
}

// ProseMirror / tiptap rely on these layout APIs that jsdom omits.
if (!document.elementFromPoint) {
  document.elementFromPoint = vi.fn(() => null);
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = vi.fn(
    () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  );
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = vi.fn(
    () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
  );
}

// Unmount React trees and clear web storage between tests so component,
// session, and setup-draft tests stay isolated.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
