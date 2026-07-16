import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TemplatePreview } from "./TemplatePreview.js";

function getFrame() {
  return screen.getByTitle("Email preview") as HTMLIFrameElement;
}

describe("TemplatePreview", () => {
  it("renders the subject with variables substituted", () => {
    render(
      <TemplatePreview
        subject="Welcome, {{firstName}}!"
        html="<p>Hi</p>"
        sampleData={{ firstName: "Ada" }}
      />
    );
    expect(screen.getByText("Welcome, Ada!")).toBeInTheDocument();
  });

  it("prefers sample data over a declared default", () => {
    render(
      <TemplatePreview
        subject="Hi {{firstName}}"
        html="<p>Hi</p>"
        variables={[{ name: "firstName", defaultValue: "friend" } as never]}
        sampleData={{ firstName: "Ada" }}
      />
    );
    expect(screen.getByText("Hi Ada")).toBeInTheDocument();
  });

  it("falls back to a declared default when no sample data is given", () => {
    render(
      <TemplatePreview
        subject="Hi {{firstName}}"
        html="<p>Hi</p>"
        variables={[{ name: "firstName", defaultValue: "friend" } as never]}
      />
    );
    expect(screen.getByText("Hi friend")).toBeInTheDocument();
  });

  it("shows a placeholder when the subject is empty", () => {
    render(<TemplatePreview subject="" html="<p>Hi</p>" />);
    expect(screen.getByText("(no subject)")).toBeInTheDocument();
  });

  it("renders the body html into a fully sandboxed frame", () => {
    render(<TemplatePreview subject="s" html="<p>Body copy</p>" />);
    const frame = getFrame();
    // sandbox="" — template HTML must not run scripts or reach the parent.
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("<p>Body copy</p>");
  });

  it("substitutes variables into the body html", () => {
    render(
      <TemplatePreview
        subject="s"
        html="<p>Hello {{firstName}}</p>"
        sampleData={{ firstName: "Ada" }}
      />
    );
    expect(getFrame().getAttribute("srcdoc")).toContain("<p>Hello Ada</p>");
  });

  it("defaults to the desktop viewport and switches to mobile", async () => {
    const user = userEvent.setup();
    render(<TemplatePreview subject="s" html="<p>Hi</p>" />);
    expect(getFrame()).toHaveClass("max-w-[680px]");

    await user.click(screen.getByRole("button", { name: "Mobile preview" }));
    expect(getFrame()).toHaveClass("w-[375px]");

    await user.click(screen.getByRole("button", { name: "Desktop preview" }));
    expect(getFrame()).toHaveClass("max-w-[680px]");
  });
});
