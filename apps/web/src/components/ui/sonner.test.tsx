import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "./sonner.js";

describe("Toaster", () => {
  it("renders without throwing", () => {
    const { container } = render(<Toaster />);
    expect(container).toBeTruthy();
  });
});
