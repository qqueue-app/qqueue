import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "./sonner.js";
import { ThemeProvider } from "../../lib/theme.js";

describe("Toaster", () => {
  it("renders within a theme provider without throwing", () => {
    const { container } = render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>
    );
    expect(container).toBeTruthy();
  });
});
