import { renderWithProviders } from "../../test/render.js";
import { describe, expect, it } from "vitest";
import { Toaster } from "./sonner.js";

describe("Toaster", () => {
  it("renders without throwing", () => {
    const { container } = renderWithProviders(<Toaster />);
    expect(container).toBeTruthy();
  });
});
