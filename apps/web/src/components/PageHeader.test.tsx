import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader.js";

describe("PageHeader", () => {
  it("renders the title and description", () => {
    render(<PageHeader title="Contacts" description="Manage contacts" />);
    expect(
      screen.getByRole("heading", { name: "Contacts" })
    ).toBeInTheDocument();
    expect(screen.getByText("Manage contacts")).toBeInTheDocument();
  });

  it("renders actions when provided", () => {
    render(
      <PageHeader
        title="Contacts"
        description="x"
        actions={<button>Add</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("omits the actions container when no actions provided", () => {
    const { container } = render(<PageHeader title="T" description="d" />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
