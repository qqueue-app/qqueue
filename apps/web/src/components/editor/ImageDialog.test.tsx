import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImageDialog } from "./ImageDialog.js";

function pngFile(name = "banner.png") {
  return new File(["fake-png-bytes"], name, { type: "image/png" });
}

function renderDialog(props: Partial<Parameters<typeof ImageDialog>[0]> = {}) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(
    <ImageDialog
      open
      onClose={onClose}
      onInsert={onInsert}
      onUpload={props.onUpload}
      {...props}
    />
  );
  return { onInsert, onClose };
}

/** The drop zone wraps the hidden file input. */
function dropZone() {
  return screen.getByLabelText("Upload image").parentElement!;
}

function drop(file: File) {
  fireEvent.drop(dropZone(), {
    dataTransfer: { files: [file], types: ["Files"] }
  });
}

describe("ImageDialog", () => {
  it("uploads a chosen file and inserts the returned public URL", async () => {
    const user = userEvent.setup();
    const onUpload = vi
      .fn()
      .mockResolvedValue("http://localhost:4000/api/v1/images/tok");
    const { onInsert, onClose } = renderDialog({ onUpload });

    const file = pngFile();
    await user.upload(screen.getByLabelText("Upload image"), file);

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
    expect(onInsert).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/images/tok"
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("inserts a pasted link without uploading", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    const { onInsert, onClose } = renderDialog({ onUpload });

    const field = screen.getByLabelText("Image URL");
    await user.clear(field);
    await user.type(field, "https://cdn.example.com/hero.png");
    await user.click(screen.getByRole("button", { name: "Insert image" }));

    expect(onInsert).toHaveBeenCalledWith("https://cdn.example.com/hero.png");
    expect(onUpload).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("uploads a dropped file", async () => {
    const onUpload = vi
      .fn()
      .mockResolvedValue("http://localhost:4000/api/v1/images/tok");
    const { onInsert } = renderDialog({ onUpload });

    drop(pngFile());

    await waitFor(() => expect(onInsert).toHaveBeenCalled());
    expect(onUpload).toHaveBeenCalled();
  });

  // The file picker's `accept` filter doesn't apply to drag-and-drop, so this
  // is the path where an unsupported type can actually reach the handler.
  it("rejects an unsupported dropped file before hitting the network", async () => {
    const onUpload = vi.fn();
    const { onInsert } = renderDialog({ onUpload });

    drop(new File(["<svg />"], "logo.svg", { type: "image/svg+xml" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /PNG, JPEG, GIF, or WebP/i
    );
    expect(onUpload).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("surfaces an upload failure inline and stays open", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn().mockRejectedValue(new Error("Image is too large"));
    const { onInsert, onClose } = renderDialog({ onUpload });

    await user.upload(screen.getByLabelText("Upload image"), pngFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Image is too large"
    );
    expect(onInsert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores an empty link submission", async () => {
    const user = userEvent.setup();
    const { onInsert, onClose } = renderDialog({ onUpload: vi.fn() });

    // The field is pre-filled with the "https://" stub — submitting it as-is
    // must not insert an empty image.
    await user.click(screen.getByRole("button", { name: "Insert image" }));

    expect(onInsert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers link-only when no upload handler is provided", () => {
    renderDialog();

    expect(screen.queryByLabelText("Upload image")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Image URL")).toBeInTheDocument();
    expect(screen.getByText(/Link to an image that's already online/i)).
      toBeInTheDocument();
  });
});
