import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmailPreviewFrame } from "./EmailPreviewFrame.js";

/**
 * jsdom performs no layout, so scrollHeight is always 0. Stub both roots to
 * simulate a laid-out email document of `height` px.
 */
function stubDocumentHeight(frame: HTMLIFrameElement, height: number) {
  const doc = frame.contentDocument;
  if (!doc) throw new Error("iframe has no contentDocument");
  for (const el of [doc.documentElement, doc.body]) {
    Object.defineProperty(el, "scrollHeight", { value: height, configurable: true });
  }
}

describe("EmailPreviewFrame", () => {
  it("sandboxes the frame without allowing scripts", () => {
    render(<EmailPreviewFrame html="<p>Hi</p>" />);
    const frame = screen.getByTitle("Email preview");
    // allow-same-origin lets us measure height; allow-scripts must never appear.
    expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("passes the html through srcdoc and applies overrides", () => {
    render(
      <EmailPreviewFrame
        html="<p>Hello</p>"
        title="Custom title"
        className="my-frame"
        data-testid="preview"
      />
    );
    const frame = screen.getByTestId("preview");
    expect(frame).toHaveAttribute("srcdoc", "<p>Hello</p>");
    expect(frame).toHaveAttribute("title", "Custom title");
    expect(frame).toHaveClass("my-frame");
  });

  it("starts at the default height", () => {
    render(<EmailPreviewFrame html="<p>Hi</p>" />);
    expect(screen.getByTitle("Email preview")).toHaveStyle({ height: "320px" });
  });

  it("resizes to the document height on load", async () => {
    render(<EmailPreviewFrame html="<p>Hi</p>" />);
    const frame = screen.getByTitle("Email preview") as HTMLIFrameElement;
    stubDocumentHeight(frame, 540);
    fireEvent.load(frame);
    await waitFor(() => expect(frame).toHaveStyle({ height: "540px" }));
  });

  it("re-measures after the html changes without a load event", async () => {
    const { rerender } = render(<EmailPreviewFrame html="<p>Short</p>" />);
    const frame = screen.getByTitle("Email preview") as HTMLIFrameElement;
    stubDocumentHeight(frame, 900);
    rerender(<EmailPreviewFrame html="<p>Much longer</p>" />);
    // The effect nudges a re-measure on a timer, so images that settle late
    // still size the frame.
    await waitFor(() => expect(frame).toHaveStyle({ height: "900px" }));
  });

  it("keeps the current height when the document measures zero", async () => {
    render(<EmailPreviewFrame html="" />);
    const frame = screen.getByTitle("Email preview") as HTMLIFrameElement;
    stubDocumentHeight(frame, 0);
    fireEvent.load(frame);
    await waitFor(() => expect(frame).toHaveStyle({ height: "320px" }));
  });
});
