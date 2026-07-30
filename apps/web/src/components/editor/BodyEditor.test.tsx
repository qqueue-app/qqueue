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

  // Regression: a template written as raw HTML was saved fine, then reopened
  // into the rich text editor, which parsed it into its own schema and threw
  // away everything the schema had no node for. The body came back rewritten,
  // which reads as the save having silently failed.
  it("opens a hand-written HTML fragment in the source view", async () => {
    render(
      <BodyEditor
        value={'<div style="padding:24px"><p>Hi</p></div>'}
        onChange={() => {}}
      />
    );

    const source = await screen.findByLabelText("HTML source");
    expect(source).toHaveValue('<div style="padding:24px"><p>Hi</p></div>');
    // Not a full document, so rich text stays available — just not the default.
    expect(screen.getByRole("button", { name: "Rich text" })).toBeEnabled();
  });

  // Drafts and templates arrive after mount, so the choice can't be made once
  // at mount time against an empty string.
  it("moves to the source view when unrepresentable content arrives later", async () => {
    const { rerender } = render(
      <BodyEditor value="<p>Hi</p>" onChange={() => {}} />
    );
    await screen.findByLabelText("Bold");

    rerender(
      <BodyEditor
        value={'<div class="wrap"><p>Applied template</p></div>'}
        onChange={() => {}}
      />
    );

    expect(await screen.findByLabelText("HTML source")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bold")).not.toBeInTheDocument();
  });

  it("warns before switching back to rich text would delete markup", async () => {
    const user = userEvent.setup();
    render(
      <BodyEditor value="<style>.x{}</style><p>Hi</p>" onChange={() => {}} />
    );
    await screen.findByLabelText("HTML source");

    await user.click(screen.getByRole("button", { name: "Rich text" }));

    // Named casualties, not a vague "you may lose formatting".
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/<style>/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /stay in html/i }));
    expect(screen.getByLabelText("HTML source")).toBeInTheDocument();
  });

  // The auto-switch above must not fight the user: accepting the warning has to
  // stick even though the content is still unrepresentable at that moment.
  it("switches to rich text when the user confirms the warning", async () => {
    const user = userEvent.setup();
    render(
      <BodyEditor value="<style>.x{}</style><p>Hi</p>" onChange={() => {}} />
    );
    await screen.findByLabelText("HTML source");
    await user.click(screen.getByRole("button", { name: "Rich text" }));

    await user.click(
      await screen.findByRole("button", { name: /switch anyway/i })
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Bold")).toBeInTheDocument()
    );
    expect(screen.queryByLabelText("HTML source")).not.toBeInTheDocument();
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
