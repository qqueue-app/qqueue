import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle.js";
import { ThemeProvider } from "../lib/theme.js";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("renders a toggle button defaulting to light (offers dark)", () => {
    renderToggle();
    expect(
      screen.getByRole("button", { name: "Switch to dark mode" })
    ).toBeInTheDocument();
  });

  it("flips the label after toggling", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(
      screen.getByRole("button", { name: "Switch to dark mode" })
    );
    expect(
      screen.getByRole("button", { name: "Switch to light mode" })
    ).toBeInTheDocument();
  });
});
