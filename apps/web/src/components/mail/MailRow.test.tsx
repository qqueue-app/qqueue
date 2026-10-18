import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../../test/render.js";
import { DataGrid } from "../ui/data-grid.js";
import { MailRow } from "./MailRow.js";
describe("mail scanning and keyboard navigation", () => {
  it("announces attachments, counts and delivery warnings without losing the correspondence", () => {
    renderWithProviders(
      <MailRow
        sender="Amara"
        subject="Launch"
        preview="Revised concepts"
        unread
        count={3}
        attachment
        status="Delivery unconfirmed"
      />
    );
    expect(screen.getByText("Amara")).toHaveClass("font-semibold");
    expect(screen.getByText("Launch")).toHaveClass("font-semibold");
    expect(screen.getByText("(3)")).toBeInTheDocument();
    expect(screen.getByLabelText("Has attachments")).toBeInTheDocument();
    expect(screen.getByText("Delivery unconfirmed")).toBeInTheDocument();
  });
  it("moves focus with j and k without opening a message, and selects only loaded rows", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DataGrid
        variant="mail"
        label="Mail"
        data={[{ id: "a" }, { id: "b" }]}
        getRowId={(row) => row.id}
        enableSelection
        searchable={false}
        paginated={false}
        renderMobileRow={(row) => <span>{row.id}</span>}
        columns={[
          {
            id: "message",
            enableHiding: false,
            header: "Message",
            cell: ({ row }) => (
              <button className="mail-row-open">Open {row.original.id}</button>
            ),
          },
        ]}
      />
    );
    const first = screen.getByRole("button", { name: "Open a" }),
      second = screen.getByRole("button", { name: "Open b" });
    first.focus();
    await user.keyboard("j");
    expect(second).toHaveFocus();
    await user.keyboard("k");
    expect(first).toHaveFocus();
    await user.click(
      screen.getByRole("checkbox", { name: "Select all rows on this page" })
    );
    expect(screen.getByText("2 selected on this page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Select mail")).toBeInTheDocument();
  });
});
