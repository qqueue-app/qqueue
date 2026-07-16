import { render, screen } from "@testing-library/react";
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
  render(
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

  it("refuses to submit without a real URL", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderDialog();

    // Left at the "https://" stub.
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses to submit with an empty label", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await fillRequired(user);
    await user.clear(screen.getByLabelText("Button text"));
    await user.click(screen.getByRole("button", { name: "Insert button" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
