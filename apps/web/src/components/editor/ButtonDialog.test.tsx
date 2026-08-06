import { renderWithProviders, screen } from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ButtonDialog } from "./ButtonDialog.js";
import type { ButtonAlign, ButtonFormValue } from "./button-extension.js";

function renderDialog(
  initial?: Partial<ButtonFormValue>,
  currentAlign?: ButtonAlign
) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <ButtonDialog
      open
      initial={initial}
      currentAlign={currentAlign}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
  return { onSubmit, onClose };
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  const href = screen.getByLabelText("Button URL");
  await user.clear(href);
  await user.type(href, "https://example.com");
}

describe("ButtonDialog", () => {
  it("submits alignment chosen by the user rather than always centring", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await fillRequired(user);
    await user.click(screen.getByLabelText("Align right"));
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ align: "right", href: "https://example.com" })
    );
  });

  it("defaults to a medium green button", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        size: "medium",
        radius: "rounded",
        background: "#2e7d63"
      })
    );
  });

  // Inserting a button next to text must not silently re-align that text, so
  // the dialog starts from the alignment of the line it is being inserted into.
  it("inherits the current line's alignment rather than forcing centre", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog(undefined, "right");

    expect(screen.getByLabelText("Align right")).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ align: "right" })
    );
  });

  it("submits style choices", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await fillRequired(user);
    await user.click(screen.getByLabelText("Background: #dc2626"));
    await user.click(screen.getByRole("button", { name: "Large" }));
    await user.click(screen.getByRole("button", { name: "Pill" }));
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        background: "#dc2626",
        size: "large",
        radius: "pill"
      })
    );
  });

  it("pre-fills from the selected button when editing", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({
      href: "https://existing.example",
      label: "Existing",
      align: "left",
      background: "#2563eb",
      color: "#ffffff",
      size: "small",
      radius: "sharp"
    });

    expect(screen.getByLabelText("Button text")).toHaveValue("Existing");
    expect(screen.getByLabelText("Button URL")).toHaveValue(
      "https://existing.example"
    );
    expect(screen.getByLabelText("Align left")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Small" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Editing keeps the untouched values.
    await user.click(screen.getByRole("button", { name: "Save button" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Existing",
        align: "left",
        background: "#2563eb",
        size: "small",
        radius: "sharp"
      })
    );
  });

  // The caller rebuilds `initial` from live editor attributes on every renderWithProviders,
  // so a re-render while the dialog is open used to reset the form and throw
  // away edits that had not been submitted yet.
  it("keeps in-progress edits when re-rendered with fresh props", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const props = {
      href: "https://existing.example",
      label: "Existing",
      align: "left" as ButtonAlign
    };
    const { rerender } = renderWithProviders(
      <ButtonDialog
        open
        initial={{ ...props }}
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    await user.clear(screen.getByLabelText("Button text"));
    await user.type(screen.getByLabelText("Button text"), "Renamed");
    // Same values, new object identity — exactly what a re-render produces.
    rerender(
      <ButtonDialog
        open
        initial={{ ...props }}
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByLabelText("Button text")).toHaveValue("Renamed");
    await user.click(screen.getByRole("button", { name: "Save button" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Renamed" })
    );
  });

  // Nobody types the scheme, and a bare "example.com" on a button is a relative
  // link — in a mail client it resolves against nothing.
  it("fills in the scheme for a bare domain", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.type(screen.getByLabelText("Button URL"), "example.com");
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ href: "https://example.com" })
    );
  });

  it("refuses to submit without a real URL, and says so", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderDialog();

    // A scheme with nothing after it is a stub, not an address.
    await user.type(screen.getByLabelText("Button URL"), "https://");
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Refusing used to be silent, which looks exactly like a broken dialog.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add the address the button should open."
    );
  });

  it("refuses to submit with an empty label, and says so", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await fillRequired(user);
    await user.clear(screen.getByLabelText("Button text"));
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Give the button some text."
    );
  });

  it("clears the complaint once the field is fixed", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Insert button" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Button URL"), "example.com");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Insert button" }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
