import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor.js";

describe("RichTextEditor", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the toolbar with formatting controls", async () => {
    render(<RichTextEditor value="<p>Hello</p>" onChange={() => {}} />);
    expect(await screen.findByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Italic")).toBeInTheDocument();
    expect(screen.getByLabelText("Heading 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Bullet list")).toBeInTheDocument();
    expect(screen.getByLabelText("Link")).toBeInTheDocument();
    expect(screen.getByLabelText("Undo")).toBeInTheDocument();
  });

  it("exercises formatting toolbar buttons without throwing", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="<p>Hi</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Bold"));
    await user.click(screen.getByLabelText("Italic"));
    await user.click(screen.getByLabelText("Heading 1"));
    await user.click(screen.getByLabelText("Bullet list"));
    await user.click(screen.getByLabelText("Quote"));
    // editor still rendered
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
  });

  it("shows the variable menu when showVariables is true and inserts a variable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        value=""
        onChange={onChange}
        showVariables
        variables={["firstName"]}
      />
    );
    const trigger = await screen.findByRole("button", { name: /Variable/i });
    await user.click(trigger);
    const item = await screen.findByText("{{firstName}}");
    await user.click(item);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("hides the variable menu when showVariables is false", async () => {
    render(
      <RichTextEditor value="" onChange={() => {}} showVariables={false} />
    );
    await screen.findByLabelText("Bold");
    expect(
      screen.queryByRole("button", { name: /Variable/i })
    ).not.toBeInTheDocument();
  });

  it("opens a link dialog instead of a browser prompt", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt");
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>text</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Link"));

    const field = await screen.findByLabelText("Link URL");
    await user.clear(field);
    await user.type(field, "https://example.com");
    await user.click(screen.getByRole("button", { name: "Add link" }));

    expect(promptSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText("Link URL")).not.toBeInTheDocument()
    );
  });

  it("keeps the link dialog open when the URL is blank", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="<p>text</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Link"));
    await user.clear(await screen.findByLabelText("Link URL"));
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByLabelText("Link URL")).toBeInTheDocument();
  });

  it("closes the link dialog when cancelled", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="<p>text</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Link"));
    await screen.findByLabelText("Link URL");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Link URL")).not.toBeInTheDocument()
    );
  });

  it("inserts a styled button from the dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>x</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Button"));

    // Scoped to the dialog: the toolbar has its own text-alignment controls
    // with the same labels.
    const dialog = within(await screen.findByRole("dialog"));
    const label = dialog.getByLabelText("Button text");
    await user.clear(label);
    await user.type(label, "Read more");
    const href = dialog.getByLabelText("Button URL");
    await user.clear(href);
    await user.type(href, "https://example.com");
    await user.click(dialog.getByLabelText("Align right"));
    await user.click(dialog.getByRole("button", { name: "Insert button" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("data-qq-button");
    expect(html).toContain("Read more");
    // Alignment is applied to the line the button sits on.
    expect(html).toContain("text-align: right");
  });

  it("offers the button control by name, not just an icon", async () => {
    render(<RichTextEditor value="<p>x</p>" onChange={() => {}} />);
    expect(
      await screen.findByRole("button", { name: "Button" })
    ).toHaveTextContent("Button");
  });

  // Edit mode keys off a ProseMirror node selection, which needs real layout
  // to produce from a click — jsdom has none, so the switch itself is covered
  // where it can be driven honestly: `updateCtaButton` in button-extension's
  // tests, and the pre-filled Save path in ButtonDialog's.
  it("keeps a button beside the text it was inserted next to", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>Ready to start?</p>" onChange={onChange} />);

    await user.click(await screen.findByLabelText("Button"));
    const dialog = within(await screen.findByRole("dialog"));
    const href = dialog.getByLabelText("Button URL");
    await user.clear(href);
    await user.type(href, "https://example.com");
    await user.click(dialog.getByRole("button", { name: "Insert button" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    // One paragraph holding both: the button shares the line with the text
    // instead of taking its own. (It lands at the cursor, which the test
    // never moved off the start of the document.)
    expect(html).toContain("data-qq-button");
    expect(html).toContain("Ready to start?");
    expect(html.match(/<p[\s>]/g)).toHaveLength(1);
    // Alignment was untouched, so the line keeps its own.
    expect(html).not.toContain("text-align");
  });

  it("inserts a sanitized custom variable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RichTextEditor value="" onChange={onChange} showVariables />);
    await user.click(await screen.findByRole("button", { name: /Variable/i }));
    await user.click(await screen.findByText("Custom…"));

    await user.type(await screen.findByLabelText("Variable name"), "my.var!");
    await user.click(screen.getByRole("button", { name: "Insert variable" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("{{my.var}}");
  });

  it("exercises the remaining toolbar buttons", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="<p>x</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Underline"));
    await user.click(screen.getByLabelText("Strikethrough"));
    await user.click(screen.getByLabelText("Heading 2"));
    await user.click(screen.getByLabelText("Numbered list"));
    await user.click(screen.getByLabelText("Undo"));
    await user.click(screen.getByLabelText("Redo"));
    expect(screen.getByLabelText("Bold")).toBeInTheDocument();
  });

  // Regression: the editor had no table nodes in its schema, so ProseMirror
  // silently dropped pasted table markup — a table arrived as plain paragraphs
  // before anything was ever sent.
  it("keeps table markup instead of flattening it to paragraphs", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        value={
          "<table><tbody><tr><th>Quarter</th><td>Q1</td></tr></tbody></table>"
        }
        onChange={onChange}
      />
    );

    await waitFor(() => {
      expect(document.querySelector("table")).not.toBeNull();
    });
    expect(document.querySelectorAll("td").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("th").length).toBeGreaterThan(0);
  });

  it("inserts and removes a table from the toolbar", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor value="<p>Hi</p>" onChange={() => {}} />);

    await user.click(await screen.findByLabelText(/Insert table/i));
    await waitFor(() => {
      expect(document.querySelector("table")).not.toBeNull();
    });

    // With the cursor in a table the control becomes "delete".
    await user.click(await screen.findByLabelText(/Delete table/i));
    await waitFor(() => {
      expect(document.querySelector("table")).toBeNull();
    });
  });

  it("carries inline styles on table cells so mail clients keep the borders", async () => {
    render(
      <RichTextEditor
        value="<table><tbody><tr><td>A</td></tr></tbody></table>"
        onChange={() => {}}
      />
    );

    await waitFor(() => {
      expect(document.querySelector("table")).not.toBeNull();
    });
    // Class-based styling would be stripped by Gmail/Outlook; the style
    // attribute is what survives.
    const cell = document.querySelector("td");
    expect(cell?.getAttribute("style")).toContain("border");
  });
});
