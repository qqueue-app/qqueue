import { render, screen, waitFor } from "@testing-library/react";
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

  // Both of these used to open in the source view and stay there. A full
  // document locked rich text off entirely; a hand-written fragment defaulted
  // to source and warned before letting you leave. Neither is destructive any
  // more, so neither is refused.
  it("opens a complete HTML document in rich text", async () => {
    render(
      <BodyEditor
        value="<!doctype html><html><head><style>.x{}</style></head><body><p>Pasted</p></body></html>"
        onChange={() => {}}
      />
    );

    expect(await screen.findByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rich text" })).toBeEnabled();
    expect(
      screen.getByText(/Full HTML document — sent as-is/)
    ).toBeInTheDocument();
  });

  it("opens a hand-written HTML fragment in rich text", async () => {
    render(
      <BodyEditor
        value={'<div style="padding:24px"><p>Hi</p></div>'}
        onChange={() => {}}
      />
    );

    expect(await screen.findByLabelText("Bold")).toBeInTheDocument();
    expect(screen.queryByLabelText("HTML source")).not.toBeInTheDocument();
  });

  it("switches to rich text without warning about what it would lose", async () => {
    const user = userEvent.setup();
    render(
      <BodyEditor value="<style>.x{}</style><p>Hi</p>" onChange={() => {}} />
    );
    await screen.findByLabelText("Bold");
    await user.click(screen.getByRole("button", { name: "HTML" }));
    await screen.findByLabelText("HTML source");

    await user.click(screen.getByRole("button", { name: "Rich text" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Bold")).toBeInTheDocument()
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  // The regression the whole redesign is for: markup with no node in the
  // schema used to be deleted the moment the editor mounted over it, which
  // read as the save having silently failed.
  it("keeps markup the editor cannot format, and says so", async () => {
    const user = userEvent.setup();
    render(
      <ControlledBodyEditor initial="<style>.x{color:red}</style><p>Hi</p>" />
    );

    await screen.findByLabelText("Bold");
    expect(screen.getByText(/1 part is kept as HTML/)).toBeInTheDocument();
    expect(await screen.findByTestId("raw-html-block")).toBeInTheDocument();

    // And it is still there, unchanged, on the way back out.
    await user.click(screen.getByRole("button", { name: "HTML" }));
    expect(await screen.findByLabelText("HTML source")).toHaveValue(
      "<style>.x{color:red}</style><p>Hi</p>"
    );
  });

  it("reports nothing kept as HTML when everything is editable", async () => {
    render(<BodyEditor value="<p>Hi</p>" onChange={() => {}} />);
    await screen.findByLabelText("Bold");

    expect(screen.queryByText(/kept as HTML/)).not.toBeInTheDocument();
  });

  // Drafts and templates arrive after mount, so the document has to be split
  // again when one lands rather than only once at mount.
  it("takes up content that arrives after mount", async () => {
    const { rerender } = render(
      <BodyEditor value="<p>Hi</p>" onChange={() => {}} />
    );
    await screen.findByLabelText("Bold");

    rerender(
      <BodyEditor
        value={'<div class="wrap"><style>.a{}</style><p>Applied</p></div>'}
        onChange={() => {}}
      />
    );

    expect(await screen.findByTestId("raw-html-block")).toBeInTheDocument();
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
  });
});
