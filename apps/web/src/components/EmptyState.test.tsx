import { renderWithProviders, screen } from "../test/render.js";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.js";

describe("EmptyState", () => {
  it("renders the title", () => { renderWithProviders(<EmptyState icon={Inbox} title="No contacts" />);
    expect(screen.getByText("No contacts")).toBeInTheDocument();
  });

  it("renders the description and action when provided", () => { renderWithProviders(
      <EmptyState
        icon={Inbox}
        title="No contacts"
        description="Add your first contact"
        action={<button>Add</button>}
      />
    );
    expect(screen.getByText("Add your first contact")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  // Asserts absence by content rather than by tag: the title is itself a <p>
  // now, so counting paragraphs would pass or fail on markup rather than on
  // whether the optional parts actually rendered.
  it("omits the description and action when not provided", () => {
    renderWithProviders(<EmptyState icon={Inbox} title="Empty" />);
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(
      screen.queryByText("Add your first contact")
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
