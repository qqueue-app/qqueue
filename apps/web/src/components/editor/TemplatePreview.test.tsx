import { renderWithProviders, screen } from "../../test/render.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TemplatePreview } from "./TemplatePreview.js";

function getFrame() {
  return screen.getByTitle("Email preview") as HTMLIFrameElement;
}

describe("TemplatePreview", () => {
  it("renders the subject with variables substituted", () => { renderWithProviders(
      <TemplatePreview
        subject="Welcome, {{firstName}}!"
        html="<p>Hi</p>"
        sampleData={{ firstName: "Ada" }}
      />
    );
    expect(screen.getByText("Welcome, Ada!")).toBeInTheDocument();
  });

  it("prefers sample data over a declared default", () => { renderWithProviders(
      <TemplatePreview
        subject="Hi {{firstName}}"
        html="<p>Hi</p>"
        variables={[{ name: "firstName", defaultValue: "friend" } as never]}
        sampleData={{ firstName: "Ada" }}
      />
    );
    expect(screen.getByText("Hi Ada")).toBeInTheDocument();
  });

  it("falls back to a declared default when no sample data is given", () => { renderWithProviders(
      <TemplatePreview
        subject="Hi {{firstName}}"
        html="<p>Hi</p>"
        variables={[{ name: "firstName", defaultValue: "friend" } as never]}
      />
    );
    expect(screen.getByText("Hi friend")).toBeInTheDocument();
  });

  it("shows a placeholder when the subject is empty", () => { renderWithProviders(<TemplatePreview subject="" html="<p>Hi</p>" />);
    expect(screen.getByText("(no subject)")).toBeInTheDocument();
  });

  it("renders the body html into a fully sandboxed frame", () => { renderWithProviders(<TemplatePreview subject="s" html="<p>Body copy</p>" />);
    const frame = getFrame();
    // sandbox="" — template HTML must not run scripts or reach the parent.
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("<p>Body copy</p>");
  });

  it("substitutes variables into the body html", () => { renderWithProviders(
      <TemplatePreview
        subject="s"
        html="<p>Hello {{firstName}}</p>"
        sampleData={{ firstName: "Ada" }}
      />
    );
    expect(getFrame().getAttribute("srcdoc")).toContain("<p>Hello Ada</p>");
  });

  // A pasted document brings its own head and styles. Nesting it in the card
  // shell would emit two <html> elements and let the shell's styles win, so the
  // preview would stop matching what the pipeline actually sends.
  it("renders a full HTML document as its own document", () => {
    const source =
      "<!doctype html><html><head><style>.x{color:red}</style></head>" +
      "<body><p>Pasted</p></body></html>";
    renderWithProviders(<TemplatePreview subject="s" html={source} />);

    const srcDoc = getFrame().getAttribute("srcdoc") ?? "";
    expect(srcDoc).toBe(source);
    expect(srcDoc).not.toContain("qq-card");
  });

  it("still substitutes variables inside a full document", () => { renderWithProviders(
      <TemplatePreview
        subject="s"
        html="<html><body><p>Hello {{firstName}}</p></body></html>"
        sampleData={{ firstName: "Ada" }}
      />
    );
    expect(getFrame().getAttribute("srcdoc")).toContain("<p>Hello Ada</p>");
  });

  it("defaults to the desktop viewport and switches to mobile", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TemplatePreview subject="s" html="<p>Hi</p>" />);
    expect(getFrame()).toHaveClass("max-w-email");

    await user.click(screen.getByRole("button", { name: "Mobile preview" }));
    expect(getFrame()).toHaveClass("w-phone");

    await user.click(screen.getByRole("button", { name: "Desktop preview" }));
    expect(getFrame()).toHaveClass("max-w-email");
  });
});
