import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("../lib/api.js", () => ({
  api: {
    listSegments: vi.fn(),
    createSegment: vi.fn(),
    deleteSegment: vi.fn(),
    previewSegmentRules: vi.fn()
  }
}));

vi.mock("../lib/session-context.js", () => ({
  useSession: () => ({ currentOrganizationId: "org_1" })
}));

import { api } from "../lib/api.js";
import { Segments, buildRules } from "./Segments.js";

const mockedApi = api as unknown as {
  listSegments: ReturnType<typeof vi.fn>;
  createSegment: ReturnType<typeof vi.fn>;
  deleteSegment: ReturnType<typeof vi.fn>;
  previewSegmentRules: ReturnType<typeof vi.fn>;
};

describe("buildRules", () => {
  it("returns a single leaf for one condition", () => {
    expect(
      buildRules(
        [
          {
            field: "tags",
            match: "ANY",
            values: "vip, news",
            status: "ACTIVE",
            domain: ""
          }
        ],
        "AND"
      )
    ).toEqual({ field: "tags", match: "ANY", values: ["vip", "news"] });
  });

  it("wraps multiple conditions in the combinator", () => {
    const rules = buildRules(
      [
        { field: "tags", match: "ALL", values: "vip", status: "ACTIVE", domain: "" },
        { field: "status", match: "ANY", values: "", status: "ACTIVE", domain: "" }
      ],
      "OR"
    );
    expect(rules).toEqual({
      op: "OR",
      rules: [
        { field: "tags", match: "ALL", values: ["vip"] },
        { field: "status", eq: "ACTIVE" }
      ]
    });
  });

  it("returns null when no condition is complete", () => {
    expect(
      buildRules(
        [{ field: "tags", match: "ANY", values: "", status: "ACTIVE", domain: "" }],
        "AND"
      )
    ).toBeNull();
  });
});

describe("Segments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listSegments.mockResolvedValue([
      {
        id: "seg1",
        organizationId: "org_1",
        name: "VIP customers",
        rules: { field: "tags", match: "ANY", values: ["vip"] }
      }
    ]);
    mockedApi.createSegment.mockResolvedValue({ id: "seg2" });
    mockedApi.previewSegmentRules.mockResolvedValue({ count: 42, sample: [] });
  });

  it("lists existing segments", async () => {
    render(<Segments />);
    expect(await screen.findByText("VIP customers")).toBeInTheDocument();
  });

  it("previews a tag rule and creates a segment", async () => {
    const user = userEvent.setup();
    render(<Segments />);
    await screen.findByText("VIP customers");

    await user.click(screen.getByRole("button", { name: /new segment/i }));
    await user.type(screen.getByLabelText("Name"), "Newsletter");
    await user.type(screen.getByLabelText("Tag values"), "newsletter");

    await user.click(screen.getByRole("button", { name: /preview count/i }));
    await waitFor(() =>
      expect(mockedApi.previewSegmentRules).toHaveBeenCalledWith({
        organizationId: "org_1",
        rules: { field: "tags", match: "ANY", values: ["newsletter"] }
      })
    );
    expect(await screen.findByText(/42 matching contact/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save segment/i }));
    await waitFor(() =>
      expect(mockedApi.createSegment).toHaveBeenCalledWith({
        organizationId: "org_1",
        name: "Newsletter",
        rules: { field: "tags", match: "ANY", values: ["newsletter"] }
      })
    );
  });
});
