import { renderWithProviders, screen } from "../test/render.js";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CampaignsTabs } from "./CampaignsTabs.js";
import { isNavItemActive } from "./shell/nav-types.js";

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <CampaignsTabs />
    </MemoryRouter>,
    { withRouter: false }
  );
}

describe("CampaignsTabs", () => {
  it("offers campaigns and recurring as two tabs of one destination", () => {
    renderAt("/campaigns");
    expect(screen.getByRole("link", { name: "Campaigns" })).toHaveAttribute(
      "href",
      "/campaigns"
    );
    expect(screen.getByRole("link", { name: "Recurring" })).toHaveAttribute(
      "href",
      "/campaigns/recurring"
    );
  });

  it("marks Campaigns current on the index route only", () => {
    renderAt("/campaigns");
    expect(screen.getByRole("link", { name: "Campaigns" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Recurring" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("marks Recurring current without also marking Campaigns", () => {
    renderAt("/campaigns/recurring");
    expect(screen.getByRole("link", { name: "Recurring" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Campaigns" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  /*
    The sidebar item is `end: true` so /campaigns/lists can't light it, which
    would also leave it dark on the recurring tab — hence the explicit
    activePaths entry. Asserted here because the failure is invisible until you
    are standing on the page with the nav switched off.
  */
  it("keeps the Campaigns sidebar item lit on the recurring tab", () => {
    const item = {
      to: "/campaigns",
      end: true,
      activePaths: ["/campaigns/recurring"],
    };
    expect(isNavItemActive(item, "/campaigns/recurring")).toBe(true);
    expect(isNavItemActive(item, "/campaigns")).toBe(true);
    // Lists is its own destination and must not borrow this one's highlight.
    expect(isNavItemActive(item, "/campaigns/lists")).toBe(false);
  });
});
