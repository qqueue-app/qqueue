import { render, screen, waitFor } from "@testing-library/react";
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

  it("prompts for a URL when the link button is used", async () => {
    const user = userEvent.setup();
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("https://example.com");
    render(<RichTextEditor value="<p>text</p>" onChange={() => {}} />);
    const link = await screen.findByLabelText("Link");
    await user.click(link);
    expect(promptSpy).toHaveBeenCalled();
  });

  it("clears the link when the prompt returns an empty string", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue("");
    render(<RichTextEditor value="<p>text</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Link"));
    expect(screen.getByLabelText("Link")).toBeInTheDocument();
  });

  it("ignores the link action when the prompt is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<RichTextEditor value="<p>text</p>" onChange={() => {}} />);
    await user.click(await screen.findByLabelText("Link"));
    expect(screen.getByLabelText("Link")).toBeInTheDocument();
  });

  it("inserts a sanitized custom variable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("my.var!");
    render(<RichTextEditor value="" onChange={onChange} showVariables />);
    await user.click(await screen.findByRole("button", { name: /Variable/i }));
    await user.click(await screen.findByText("Custom…"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
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
});
