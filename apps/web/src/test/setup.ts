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

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }));
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

// Unmount React trees and clear localStorage between tests so component and
// session tests stay isolated.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
