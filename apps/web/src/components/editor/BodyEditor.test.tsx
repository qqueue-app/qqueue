import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BodyEditor } from "./BodyEditor.js";

/** BodyEditor is controlled, so typing needs a parent that holds the value. */
function ControlledBodyEditor({
  initial = "",
  onChange
}: {
  initial?: string;
  onChange?: (html: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <BodyEditor
      value={value}
      onChange={(html) => {
        setValue(html);
        onChange?.(html);
      }}
    />
  );
}

describe("BodyEditor", () => {
  it("starts in rich text with the editor toolbar available", async () => {
    render(<BodyEditor value="<p>Hi</p>" onChange={() => {}} />);

    expect(await screen.findByLabelText("Bold")).toBeInTheDocument();
    expect(screen.queryByLabelText("HTML source")).not.toBeInTheDocument();
  });

  it("swaps the editor for a source textarea in HTML mode", async () => {
    const user = userEvent.setup();
    render(<BodyEditor value="<p>Hi</p>" onChange={() => {}} />);
    await screen.findByLabelText("Bold");

    await user.click(screen.getByRole("button", { name: "HTML" }));

    const source = await screen.findByLabelText("HTML source");
    expect(source).toHaveValue("<p>Hi</p>");
    // The rich text editor must be unmounted, not hidden: leaving it mounted
    // lets its schema round-trip rewrite the buffer being hand-edited.
    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();
  });

  // The whole point of the source view: markup Tiptap has no node for reaches
  // onChange byte-for-byte instead of being silently dropped.
  it("passes hand-written HTML through untouched", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledBodyEditor onChange={onChange} />);
    await screen.findByLabelText("Bold");
    await user.click(screen.getByRole("button", { name: "HTML" }));

    const source = await screen.findByLabelText("HTML source");
    await user.type(source, "<table><tr><td>x");

    expect(onChange).toHaveBeenLastCalledWith("<table><tr><td>x");
    expect(source).toHaveValue("<table><tr><td>x");
  });

  it("opens a full HTML document in source mode and locks rich text off", async () => {
    render(
      <BodyEditor
        value="<!doctype html><html><body><p>Pasted</p></body></html>"
        onChange={() => {}}
      />
    );

    expect(await screen.findByLabelText("HTML source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rich text" })).toBeDisabled();
    expect(
      screen.getByText(/Full HTML document — sent as-is/)
    ).toBeInTheDocument();
  });

  it("warns before switching back to rich text would delete markup", async () => {
    const user = userEvent.setup();
    render(
      <BodyEditor value="<style>.x{}</style><p>Hi</p>" onChange={() => {}} />
    );
    await screen.findByLabelText("Bold");
    await user.click(screen.getByRole("button", { name: "HTML" }));
    await screen.findByLabelText("HTML source");

    await user.click(screen.getByRole("button", { name: "Rich text" }));

    // Named casualties, not a vague "you may lose formatting".
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/<style>/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /stay in html/i }));
    expect(screen.getByLabelText("HTML source")).toBeInTheDocument();
  });

  it("switches to rich text when the user confirms the warning", async () => {
    const user = userEvent.setup();
    render(
      <BodyEditor value="<style>.x{}</style><p>Hi</p>" onChange={() => {}} />
    );
    await screen.findByLabelText("Bold");
    await user.click(screen.getByRole("button", { name: "HTML" }));
    await screen.findByLabelText("HTML source");
    await user.click(screen.getByRole("button", { name: "Rich text" }));

    await user.click(
      await screen.findByRole("button", { name: /switch anyway/i })
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Bold")).toBeInTheDocument()
    );
  });

  it("switches back without a warning when nothing would be lost", async () => {
    const user = userEvent.setup();
    render(<BodyEditor value="<p>Hi</p>" onChange={() => {}} />);
    await screen.findByLabelText("Bold");
    await user.click(screen.getByRole("button", { name: "HTML" }));
    await screen.findByLabelText("HTML source");

    await user.click(screen.getByRole("button", { name: "Rich text" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Bold")).toBeInTheDocument()
    );
  });
});
