import { renderWithProviders, screen, waitFor, within } from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor.js";
import { partitionForSchema } from "./partition.js";

describe("RichTextEditor", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the toolbar with formatting controls", async () => { renderWithProviders(<RichTextEditor value="<p>Hello</p>" onChange={() => {}} />);
    expect(await screen.findByLabelText("Bold")).toBeInTheDocument();
    expect(screen.getByLabelText("Italic")).toBeInTheDocument();
    expect(screen.getByLabelText("Heading 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Bullet list")).toBeInTheDocument();
    expect(screen.getByLabelText("Link")).toBeInTheDocument();
    expect(screen.getByLabelText("Undo")).toBeInTheDocument();
  });

  it("exercises formatting toolbar buttons without throwing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RichTextEditor value="<p>Hi</p>" onChange={() => {}} />);
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
    renderWithProviders(
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

  it("hides the variable menu when showVariables is false", async () => { renderWithProviders(
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
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Link"));

    const field = await screen.findByLabelText("Link URL");
    await user.clear(field);
    await user.type(field, "https://example.com");
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    expect(promptSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText("Link URL")).not.toBeInTheDocument()
    );
  });

  // Regression: with nothing selected there was no text to carry the mark, so
  // the link became a stored mark that vanished with the next selection change —
  // the dialog closed as though it had worked and the document was untouched.
  it("inserts a link at the cursor when no text is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Link"));

    await user.clear(await screen.findByLabelText("Link URL"));
    await user.type(screen.getByLabelText("Link URL"), "https://example.com");
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain('href="https://example.com"');
    // With no link text given, the address is its own label.
    expect(html).toContain(">https://example.com</a>");
  });

  it("uses the given link text as the visible label", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Link"));

    await user.clear(await screen.findByLabelText("Link URL"));
    await user.type(screen.getByLabelText("Link URL"), "https://example.com");
    await user.type(screen.getByLabelText("Link text"), "our docs");
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain(">our docs</a>");
  });

  // Typing the scheme is not something anyone should have to remember, and a
  // bare "example.com" stored verbatim is a relative link: in a mail client it
  // resolves against nothing.
  it("fills in the scheme for a bare domain", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Link"));

    await user.type(await screen.findByLabelText("Link URL"), "example.com");
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      'href="https://example.com"'
    );
  });

  it("links a bare email address with mailto:", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Link"));

    await user.type(
      await screen.findByLabelText("Link URL"),
      "support@example.com"
    );
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      'href="mailto:support@example.com"'
    );
  });

  // The field used to open pre-filled with "https://", which passed the
  // required check untouched and linked the text to nothing.
  it("refuses a scheme with no address after it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={onChange} />);
    await user.click(await screen.findByLabelText("Link"));

    await user.type(await screen.findByLabelText("Link URL"), "https://");
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Link URL is required");
    expect(screen.getByLabelText("Link URL")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the link dialog open and says why when the URL is blank", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Link"));
    await user.clear(await screen.findByLabelText("Link URL"));
    await user.click(screen.getByRole("button", { name: "Insert link" }));
    expect(screen.getByLabelText("Link URL")).toBeInTheDocument();
    // Silence used to be the only feedback.
    expect(screen.getByRole("alert")).toHaveTextContent("Link URL is required");
  });

  it("closes the link dialog when cancelled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RichTextEditor value="<p>text</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Link"));
    await screen.findByLabelText("Link URL");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Link URL")).not.toBeInTheDocument()
    );
  });

  // A selected button needs a ProseMirror node selection, which only a real
  // click produces — so the link control's button branch is covered where it can
  // be driven honestly: `updateCtaButton` in button-extension's tests.

  it("inserts a styled button from the dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="<p>x</p>" onChange={onChange} />);
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

  it("offers the button control by name, not just an icon", async () => { renderWithProviders(<RichTextEditor value="<p>x</p>" onChange={() => {}} />);
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
    renderWithProviders(<RichTextEditor value="<p>Ready to start?</p>" onChange={onChange} />);

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

  // Regression: every one of these dialogs is a <form> inside the page's own
  // <form>. Radix portals them out of the DOM but not out of the React tree, so
  // React carried their submit up to the page — adding a link saved and left the
  // template editor, and in Email Studio it would have sent the message.
  describe("inside a page form", () => {
    function renderInForm() {
      const onPageSubmit = vi.fn((event: React.FormEvent) =>
        event.preventDefault()
      );
      renderWithProviders(
        <form onSubmit={onPageSubmit}>
          <RichTextEditor
            value="<p>text</p>"
            onChange={() => {}}
            onUploadImage={async () => "https://cdn.example.com/a.png"}
          />
          <button type="submit">Save changes</button>
        </form>
      );
      return onPageSubmit;
    }

    it("does not submit the page when a link is added", async () => {
      const user = userEvent.setup();
      const onPageSubmit = renderInForm();

      await user.click(await screen.findByLabelText("Link"));
      await user.type(await screen.findByLabelText("Link URL"), "example.com");
      await user.click(screen.getByRole("button", { name: "Insert link" }));

      await waitFor(() =>
        expect(screen.queryByLabelText("Link URL")).not.toBeInTheDocument()
      );
      expect(onPageSubmit).not.toHaveBeenCalled();
    });

    // Enter in the URL field is the same submit by another route.
    it("does not submit the page when the link dialog is confirmed with Enter", async () => {
      const user = userEvent.setup();
      const onPageSubmit = renderInForm();

      await user.click(await screen.findByLabelText("Link"));
      await user.type(
        await screen.findByLabelText("Link URL"),
        "example.com{Enter}"
      );

      expect(onPageSubmit).not.toHaveBeenCalled();
    });

    it("does not submit the page when a button is inserted", async () => {
      const user = userEvent.setup();
      const onPageSubmit = renderInForm();

      await user.click(await screen.findByRole("button", { name: "Button" }));
      const dialog = within(await screen.findByRole("dialog"));
      await user.type(dialog.getByLabelText("Button URL"), "example.com");
      await user.click(dialog.getByRole("button", { name: "Insert button" }));

      expect(onPageSubmit).not.toHaveBeenCalled();
    });

    it("does not submit the page when an image is inserted", async () => {
      const user = userEvent.setup();
      const onPageSubmit = renderInForm();

      await user.click(await screen.findByLabelText("Image"));
      const dialog = within(await screen.findByRole("dialog"));
      await user.type(
        dialog.getByLabelText("Image URL"),
        "example.com/banner.png"
      );
      await user.click(dialog.getByRole("button", { name: "Insert image" }));

      expect(onPageSubmit).not.toHaveBeenCalled();
    });

    it("still submits the page from its own button", async () => {
      const user = userEvent.setup();
      const onPageSubmit = renderInForm();

      await screen.findByLabelText("Link");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(onPageSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it("inserts a sanitized custom variable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="" onChange={onChange} showVariables />);
    await user.click(await screen.findByRole("button", { name: /Variable/i }));
    await user.click(await screen.findByText("Custom…"));

    await user.type(await screen.findByLabelText("Variable name"), "my.var!");
    await user.click(screen.getByRole("button", { name: "Insert variable" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("{{my.var}}");
  });

  it("exercises the remaining toolbar buttons", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RichTextEditor value="<p>x</p>" onChange={() => {}} />);
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
    renderWithProviders(
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
    renderWithProviders(<RichTextEditor value="<p>Hi</p>" onChange={() => {}} />);

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

  // Everything this editor can produce has to survive being reloaded into it.
  // Anything that doesn't comes back as a frozen raw block, so content written
  // here would reopen as an uneditable slab of HTML — the schema disagreeing
  // with itself. Checked against the editor's real output rather than against a
  // reading of the extension list.
  it("produces markup that round-trips back into rich text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RichTextEditor value="<p>Hello</p>" onChange={onChange} />);

    await user.click(await screen.findByLabelText("Bold"));
    await user.keyboard("bold text");
    await user.click(screen.getByLabelText("Heading 2"));
    await user.click(screen.getByLabelText("Align centre"));
    await user.click(screen.getByLabelText("Numbered list"));
    await user.click(screen.getByLabelText("Divider"));
    await user.click(screen.getByLabelText(/Insert table/i));
    await user.click(screen.getByLabelText("Add row"));

    // A link, an image and a CTA button — the three that carry attributes.
    await user.click(screen.getByLabelText("Link"));
    await user.type(await screen.findByLabelText("Link URL"), "example.com");
    await user.click(screen.getByRole("button", { name: "Insert link" }));

    await user.click(screen.getByRole("button", { name: "Button" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Button URL"), "example.com");
    await user.click(dialog.getByRole("button", { name: "Insert button" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("data-qq-button");
    expect(html).toContain("<table");
    expect(partitionForSchema(html).frozen).toBe(0);
  });

  // Class-based styling would be stripped by Gmail and Outlook, so a table
  // inserted from the toolbar carries its borders as inline styles.
  it("gives a table inserted from the toolbar inline borders", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RichTextEditor value="<p>Hi</p>" onChange={() => {}} />);

    await user.click(await screen.findByLabelText(/Insert table/i));

    await waitFor(() => {
      expect(document.querySelector("table")).not.toBeNull();
    });
    expect(document.querySelector("td")?.getAttribute("style")).toContain(
      "border"
    );
  });

  // …and a table that arrived with no styling of its own keeps none. That
  // styling used to be a static attribute stamped onto every table on renderWithProviders,
  // which meant a pasted layout table came back carrying borders it never had —
  // a visible change to the email, and enough of one that the table stopped
  // round-tripping and was frozen out of the editor entirely.
  it("leaves a pasted bare table unstyled", async () => { renderWithProviders(
      <RichTextEditor
        value='<table width="600"><tbody><tr><td>A</td></tr></tbody></table>'
        onChange={() => {}}
      />
    );

    await waitFor(() => {
      expect(document.querySelector("table")).not.toBeNull();
    });
    expect(document.querySelector("td")?.getAttribute("style")).toBeNull();
    expect(document.querySelector("table")?.getAttribute("width")).toBe("600");
  });
});
