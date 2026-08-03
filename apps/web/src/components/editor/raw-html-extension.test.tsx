import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor.js";
import { partitionForSchema } from "./partition.js";
import {
  decodeRaw,
  encodeRaw,
  isInvisible,
  sanitizeForPreview
} from "./raw-html-extension.js";

/** Loads `source` the way BodyEditor does, so raw blocks actually appear. */
function Editor({
  source,
  onChange
}: {
  source: string;
  onChange?: (html: string) => void;
}) {
  const [value, setValue] = useState(() => partitionForSchema(source).html);
  return (
    <RichTextEditor
      value={value}
      onChange={(html) => {
        setValue(html);
        onChange?.(html);
      }}
    />
  );
}

function rawBlock() {
  return document.querySelector<HTMLElement>('[data-testid="raw-html-block"]');
}

describe("encodeRaw / decodeRaw", () => {
  // The payload is arbitrary markup that has to survive an attribute, a
  // serializer and a parser. Anything that mangles it loses the one thing the
  // node exists to protect.
  it.each([
    '<div class="a" style="color:red">Hi</div>',
    "<p>Tom &amp; Jerry — \"quoted\", 'single'</p>",
    "<style>.x::after{content:'<>'}</style>",
    "<p>Ünïcödé 🎉 emoji</p>",
    "<!--[if mso]><table><tr><td>x</td></tr></table><![endif]-->"
  ])("round-trips %s", (html) => {
    expect(decodeRaw(encodeRaw(html))).toBe(html);
  });

  it("returns nothing rather than throwing on a corrupt payload", () => {
    expect(decodeRaw("not base64 !!!")).toBe("");
  });
});

describe("sanitizeForPreview", () => {
  // The preview renders into a shadow root, which isolates styles but not
  // scripts — so anything that could execute has to be taken out of the preview
  // before it reaches the page. The stored markup keeps it.
  it("removes scripts and inline handlers", () => {
    const cleaned = sanitizeForPreview(
      '<div><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">go</a></div>'
    );

    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("onerror");
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).toContain("<img");
  });

  it("leaves ordinary markup alone", () => {
    const html = '<table width="600"><tbody><tr><td>Hi</td></tr></tbody></table>';

    expect(sanitizeForPreview(html)).toContain('width="600"');
  });
});

describe("isInvisible", () => {
  it.each(["<style>.x{}</style>", "<!--[if mso]>x<![endif]-->", ""])(
    "treats %s as rendering nothing",
    (html) => {
      expect(isInvisible(html)).toBe(true);
    }
  );

  it("treats markup with content as visible", () => {
    expect(isInvisible('<div style="padding:8px">Hi</div>')).toBe(false);
  });
});

describe("raw blocks in the editor", () => {
  it("frames markup the schema cannot hold and names it", async () => {
    render(<Editor source="<style>.x{color:red}</style><p>Body</p>" />);

    await screen.findByLabelText("Bold");
    await waitFor(() => expect(rawBlock()).not.toBeNull());
    expect(rawBlock()).toHaveTextContent("<style> block");
  });

  // A conditional comment has tags inside it, so naming a block by the first
  // tag it can find would call this one a "<td> block".
  it("names a conditional comment by what it is", async () => {
    render(
      <Editor source="<p>A</p><!--[if mso]><td>spacer</td><![endif]--><p>B</p>" />
    );

    await screen.findByLabelText("Bold");
    await waitFor(() => expect(rawBlock()).not.toBeNull());
    expect(rawBlock()).toHaveTextContent("Outlook-only HTML");
  });

  // The legacy tag is frozen where it stands, inside a cell of a table that
  // stays editable around it.
  it("renders a visible block's markup in an isolated shadow root", async () => {
    render(
      <Editor source='<table width="600"><tbody><tr><td><font color="#333">Legacy</font></td></tr></tbody></table>' />
    );

    await screen.findByLabelText("Bold");
    await waitFor(() => expect(rawBlock()).not.toBeNull());

    const preview = rawBlock()!.querySelector(".qq-raw-block__preview");
    // A shadow root, so the payload's own styles can't leak into the app and
    // the app's styles can't make the block look like something it won't be.
    expect(preview?.shadowRoot?.innerHTML).toContain("Legacy");
    expect(document.querySelector("table")).not.toBeNull();
  });

  it("opens the source dialog on the block's own markup and saves it back", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Editor source="<style>.x{color:red}</style><p>Body</p>" onChange={onChange} />
    );

    await screen.findByLabelText("Bold");
    await waitFor(() => expect(rawBlock()).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Edit HTML" }));

    const dialog = within(await screen.findByRole("dialog"));
    const source = dialog.getByLabelText("Block HTML");
    expect(source).toHaveValue("<style>.x{color:red}</style>");

    await user.clear(source);
    // Pasted rather than typed: user-event reads `{` as the start of a key
    // descriptor, and CSS is mostly braces.
    await user.click(source);
    await user.paste("<style>.x{color:blue}</style>");
    await user.click(dialog.getByRole("button", { name: "Save block" }));

    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toContain(
        encodeRaw("<style>.x{color:blue}</style>")
      )
    );
  });

  it("removes a block on request", async () => {
    const user = userEvent.setup();
    render(<Editor source="<style>.x{}</style><p>Body</p>" />);

    await screen.findByLabelText("Bold");
    await waitFor(() => expect(rawBlock()).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(rawBlock()).toBeNull());
  });

  // The other half of the point: dropping a snippet in no longer means leaving
  // the editor for the whole-document source view.
  it("inserts a new block from the toolbar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Editor source="<p>Body</p>" onChange={onChange} />);

    await screen.findByLabelText("Bold");
    expect(rawBlock()).toBeNull();

    await user.click(screen.getByLabelText("HTML block"));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(
      dialog.getByLabelText("Block HTML"),
      '<table width="600"></table>'
    );
    await user.click(dialog.getByRole("button", { name: "Insert" }));

    await waitFor(() => expect(rawBlock()).not.toBeNull());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      encodeRaw('<table width="600"></table>')
    );
  });

  it("closes without inserting anything when the source is left blank", async () => {
    const user = userEvent.setup();
    render(<Editor source="<p>Body</p>" />);

    await screen.findByLabelText("Bold");
    await user.click(screen.getByLabelText("HTML block"));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Insert"
      })
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(rawBlock()).toBeNull();
  });

  // Radix portals the dialog out of the DOM but not out of the React tree, so
  // its submit bubbles into whatever page form the editor sits in — which in
  // Email Studio would send the message.
  it("does not submit the page form when a block is saved", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Editor source="<p>Body</p>" />
      </form>
    );

    await screen.findByLabelText("Bold");
    await user.click(screen.getByLabelText("HTML block"));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Block HTML"), "<hr data-x>");
    await user.click(dialog.getByRole("button", { name: "Insert" }));

    await waitFor(() => expect(rawBlock()).not.toBeNull());
    expect(submit).not.toHaveBeenCalled();
  });
});
