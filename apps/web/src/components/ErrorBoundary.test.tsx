import { renderWithProviders, screen } from "../test/render.js";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";

function Bomb(): never {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => { renderWithProviders(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("catches a render throw and shows the fallback with a reload action", () => {
    // React logs caught errors loudly; keep the test output clean.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });

    renderWithProviders(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    screen.getByRole("button", { name: "Reload" }).click();
    expect(reload).toHaveBeenCalled();

    Object.defineProperty(window, "location", {
      configurable: true,
      value: original,
    });
    consoleError.mockRestore();
  });
});
