import { renderWithProviders, screen } from "../test/render.js";
import { describe, expect, it } from "vitest";
import { DashboardSplash } from "./DashboardSplash.js";

describe("DashboardSplash", () => {
  it("exposes a labelled loading status to assistive tech", () => { renderWithProviders(<DashboardSplash />);
    expect(screen.getByRole("status", { name: "Loading QQueue dashboard" })).toBeInTheDocument();
  });

  it("renders the pipeline stages in order", () => { renderWithProviders(<DashboardSplash />);
    const stages = ["Accepted", "Queued", "Sending", "Delivered"];
    for (const stage of stages) {
      expect(screen.getByText(stage)).toBeInTheDocument();
    }
  });

  it("staggers the node animation by stage index", () => {
    const { container } = renderWithProviders(<DashboardSplash />);
    const nodes = container.querySelectorAll<HTMLElement>(".dashboard-splash-node");
    expect(nodes).toHaveLength(4);
    expect(nodes[0].style.animationDelay).toBe("0ms");
    expect(nodes[3].style.animationDelay).toBe("480ms");
  });
});
