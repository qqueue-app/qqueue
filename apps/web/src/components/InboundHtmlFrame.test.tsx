import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InboundHtmlFrame } from "./InboundHtmlFrame.js";

function srcdocOf(
  html: string,
  showRemoteContent = false,
  inlineImages?: Record<string, string>
) {
  render(
    <InboundHtmlFrame
      html={html}
      showRemoteContent={showRemoteContent}
      inlineImages={inlineImages}
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

    expect(srcdoc).toContain("img-src data: blob:;");
    expect(srcdoc).not.toContain("https:");
    // Stripped rather than left to fail: a CSP-refused <img> renders as a
    // broken-image icon, which reads as a bug rather than as a privacy choice.
    expect(srcdoc).not.toContain("tracker.test");
  });

  it("permits remote images once the reader opts in", () => {
    const srcdoc = srcdocOf('<img src="https://tracker.test/p.gif">', true);

    expect(srcdoc).toContain("img-src data: blob: https: http:");
    expect(srcdoc).toContain("https://tracker.test/p.gif");
  });

  it("renders inline cid: images without an opt-in, since they arrived with the message", () => {
    const srcdoc = srcdocOf(
      '<p>hi</p><img src="cid:logo@corp">',
      false,
      { "logo@corp": "blob:http://localhost/abc" }
    );

    expect(srcdoc).toContain('src="blob:http://localhost/abc"');
    expect(srcdoc).not.toContain("cid:logo@corp");
  });

  it("matches a cid: reference to a Content-ID that arrived in angle brackets", () => {
    // The MIME header is `<logo@corp>`; the body URL is `cid:logo@corp`.
    const srcdoc = srcdocOf('<img src="cid:LOGO@corp">', false, {
      "logo@corp": "blob:http://localhost/abc"
    });

    expect(srcdoc).toContain('src="blob:http://localhost/abc"');
  });

  it("drops an unresolvable inline part instead of leaving a broken image", () => {
    const srcdoc = srcdocOf('<img src="cid:missing@corp" alt="Logo">');

    expect(srcdoc).not.toContain("cid:missing@corp");
    expect(srcdoc).toContain('alt="Logo"');
  });

  it("keeps head styles when a full document is rewritten for images", () => {
    const srcdoc = srcdocOf(
      "<html><head><style>.brand{color:red}</style></head><body><img src=\"cid:x\"><p>inner</p></body></html>"
    );

    expect(srcdoc).toContain(".brand{color:red}");
    expect(srcdoc).toContain("<p>inner</p>");
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
