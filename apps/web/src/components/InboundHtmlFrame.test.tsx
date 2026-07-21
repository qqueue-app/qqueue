import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InboundHtmlFrame } from "./InboundHtmlFrame.js";

function srcdocOf(html: string, showRemoteContent = false) {
  render(
    <InboundHtmlFrame
      html={html}
      showRemoteContent={showRemoteContent}
      title="Message body"
    />
  );
  return screen.getByTitle("Message body").getAttribute("srcdoc") ?? "";
}

describe("InboundHtmlFrame", () => {
  it("renders the message inside an iframe rather than the page DOM", () => {
    render(
      <InboundHtmlFrame
        html="<p>hello</p>"
        showRemoteContent={false}
        title="Message body"
      />
    );

    const frame = screen.getByTitle("Message body");
    expect(frame.tagName).toBe("IFRAME");
    // The message must not be injected into the surrounding document.
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });

  it("never grants allow-scripts", () => {
    render(
      <InboundHtmlFrame
        html="<p>hi</p>"
        showRemoteContent={false}
        title="Message body"
      />
    );

    const sandbox = screen.getByTitle("Message body").getAttribute("sandbox");
    expect(sandbox).toBe("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
  });

  it("blocks scripts and network fetches via CSP independently of the sandbox", () => {
    const srcdoc = srcdocOf("<script>alert(1)</script><p>hi</p>");

    expect(srcdoc).toContain("default-src 'none'");
    // The CSP meta must precede the message body so it governs it.
    expect(srcdoc.indexOf("Content-Security-Policy")).toBeLessThan(
      srcdoc.indexOf("alert(1)")
    );
  });

  it("blocks remote images by default so opening a message can't be tracked", () => {
    const srcdoc = srcdocOf('<img src="https://tracker.test/p.gif">');

    expect(srcdoc).toContain("img-src data:;");
    expect(srcdoc).not.toContain("img-src data: https:");
  });

  it("permits remote images once the reader opts in", () => {
    const srcdoc = srcdocOf('<img src="https://tracker.test/p.gif">', true);

    expect(srcdoc).toContain("img-src data: https: http:");
  });

  it("preserves table markup and gives it legible defaults", () => {
    const srcdoc = srcdocOf(
      "<table><tr><th>Q</th><td>42</td></tr></table>"
    );

    expect(srcdoc).toContain("<table><tr><th>Q</th><td>42</td></tr></table>");
    expect(srcdoc).toContain("border-collapse:collapse");
  });

  it("nests a full HTML document without losing its content", () => {
    const srcdoc = srcdocOf(
      "<html><head><title>x</title></head><body><p>inner</p></body></html>"
    );

    expect(srcdoc).toContain("<p>inner</p>");
    // Our own shell is still the outer document, so the CSP applies.
    expect(srcdoc.startsWith("<!doctype html>")).toBe(true);
  });
});
