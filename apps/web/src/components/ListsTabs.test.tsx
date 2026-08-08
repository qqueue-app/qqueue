import { renderWithProviders, screen } from "../test/render.js";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ListsTabs } from "./ListsTabs.js";

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <ListsTabs />
    </MemoryRouter>,
    { withRouter: false }
  );
}

describe("ListsTabs", () => {
  it("offers manual and smart as two tabs of one destination", () => {
    renderAt("/campaigns/lists");
    expect(screen.getByRole("link", { name: "Manual" })).toHaveAttribute(
      "href",
      "/campaigns/lists"
    );
    expect(screen.getByRole("link", { name: "Smart" })).toHaveAttribute(
      "href",
      "/campaigns/lists/smart"
    );
  });

  it("marks Manual current on the index route only", () => {
    renderAt("/campaigns/lists");
    expect(screen.getByRole("link", { name: "Manual" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Smart" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("marks Smart current on the smart route without also marking Manual", () => {
    renderAt("/campaigns/lists/smart");
    expect(screen.getByRole("link", { name: "Smart" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Manual" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
