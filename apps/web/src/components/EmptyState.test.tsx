import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.js";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState icon={Inbox} title="No contacts" />);
    expect(screen.getByText("No contacts")).toBeInTheDocument();
  });

  it("renders the description and action when provided", () => {
    render(
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

  it("omits the description and action when not provided", () => {
    const { container } = render(<EmptyState icon={Inbox} title="Empty" />);
    expect(container.querySelector("p")).toBeNull();
  });
});
