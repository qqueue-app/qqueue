import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "../test/render.js";
import { OfflineBanner } from "./OfflineBanner.js";

/**
 * `navigator.onLine` is a getter with no setter, so it has to be redefined
 * rather than assigned. Returns a restore function.
 */
function setOnline(value: boolean) {
  const original = Object.getOwnPropertyDescriptor(
    window.navigator.constructor.prototype,
    "onLine"
  );
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
  return () => {
    Reflect.deleteProperty(window.navigator, "onLine");
    if (original) {
      Object.defineProperty(
        window.navigator.constructor.prototype,
        "onLine",
        original
      );
    }
  };
}

describe("OfflineBanner (§5)", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("says nothing while the connection is up", () => {
    restore = setOnline(true);
    renderWithProviders(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains that the data on screen is cached when offline", () => {
    restore = setOnline(false);
    renderWithProviders(<OfflineBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/offline/i);
    expect(banner).toHaveTextContent(/cached data/i);
  });

  it("appears and clears with the browser's connectivity events", () => {
    restore = setOnline(true);
    renderWithProviders(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const restoreOffline = setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    restoreOffline();
    restore = setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is polite, not an alert — losing signal interrupts nothing", () => {
    restore = setOnline(false);
    renderWithProviders(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
