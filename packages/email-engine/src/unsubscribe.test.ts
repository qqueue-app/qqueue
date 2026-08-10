import { describe, expect, it } from "vitest";
import {
  appendUnsubscribeFooter,
  appendUnsubscribeFooterText,
  buildListUnsubscribeHeaders,
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken
} from "./unsubscribe.js";

const SECRET = "test-unsubscribe-secret";

describe("unsubscribe tokens", () => {
  it("round-trips an org/email payload", () => {
    const token = signUnsubscribeToken(
      { o: "org_1", e: "user@example.com" },
      SECRET
    );
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({
      o: "org_1",
      e: "user@example.com"
    });
  });

  it("rejects a tampered signature", () => {
    const token = signUnsubscribeToken({ o: "org_1", e: "u@x.com" }, SECRET);
    const [body] = token.split(".");
    expect(verifyUnsubscribeToken(`${body}.deadbeef`, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signUnsubscribeToken({ o: "org_1", e: "u@x.com" }, SECRET);
    expect(verifyUnsubscribeToken(token, "other-secret")).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyUnsubscribeToken("not-a-token", SECRET)).toBeNull();
  });
});

describe("buildUnsubscribeUrl", () => {
  it("builds an absolute API URL carrying the token, trimming trailing slashes", () => {
    const url = buildUnsubscribeUrl(
      "https://app.example.com/",
      "org_1",
      "u@x.com",
      SECRET
    );
    expect(url).toMatch(
      /^https:\/\/app\.example\.com\/api\/v1\/unsubscribe\?token=/
    );
    const token = new URL(url).searchParams.get("token")!;
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({
      o: "org_1",
      e: "u@x.com"
    });
  });
});

describe("buildListUnsubscribeHeaders", () => {
  it("returns RFC 8058 one-click headers with the URL angle-bracketed", () => {
    const headers = buildListUnsubscribeHeaders(
      "https://app.example.com",
      "org_1",
      "u@x.com",
      SECRET
    );
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/app\.example\.com\/api\/v1\/unsubscribe\?token=.+>$/
    );
  });
});

describe("appendUnsubscribeFooter", () => {
  const url = buildUnsubscribeUrl("https://app.example.com", "org_1", "u@x.com", SECRET);

  it("appends a linked footer to a body fragment", () => {
    const html = appendUnsubscribeFooter("<p>Hello</p>", url)!;
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Unsubscribe</a>");
  });

  it("inserts inside <body> rather than after it for a complete document", () => {
    const html = appendUnsubscribeFooter(
      "<!doctype html><html><body><p>Hi</p></body></html>",
      url
    )!;
    expect(html).toMatch(/Unsubscribe<\/a><\/div><\/body>/);
    expect(html.indexOf("Unsubscribe")).toBeLessThan(html.indexOf("</body>"));
  });

  it("does not add a second footer when the body already links to the endpoint", () => {
    const existing = `<p>Bye</p><a href="${url}">Opt out</a>`;
    expect(appendUnsubscribeFooter(existing, url)).toBe(existing);
  });

  it("styles inline only, since Gmail strips <style> blocks", () => {
    const html = appendUnsubscribeFooter("<p>Hi</p>", url)!;
    expect(html).not.toContain("<style");
    expect(html).toContain("color:#9aa5b1");
  });

  it("leaves empty HTML alone, matching injectTracking's contract", () => {
    expect(appendUnsubscribeFooter("", url)).toBe("");
    expect(appendUnsubscribeFooter(null, url)).toBeUndefined();
    expect(appendUnsubscribeFooter(undefined, url)).toBeUndefined();
  });
});

describe("appendUnsubscribeFooterText", () => {
  const url = buildUnsubscribeUrl("https://app.example.com", "org_1", "u@x.com", SECRET);

  it("appends a plaintext opt-out line", () => {
    expect(appendUnsubscribeFooterText("Hello there\n", url)).toBe(
      `Hello there\n\n--\nUnsubscribe: ${url}\n`
    );
  });

  it("does not invent a text part for an HTML-only message", () => {
    expect(appendUnsubscribeFooterText(null, url)).toBeUndefined();
    expect(appendUnsubscribeFooterText(undefined, url)).toBeUndefined();
    expect(appendUnsubscribeFooterText("", url)).toBe("");
  });

  it("leaves text that already carries the link alone", () => {
    const existing = `Bye\nOpt out: ${url}`;
    expect(appendUnsubscribeFooterText(existing, url)).toBe(existing);
  });
});

describe("unsubscribe footer note", () => {
  const url = buildUnsubscribeUrl("https://app.example.com", "org_1", "u@x.com", SECRET);

  it("renders the note above the link, escaped", () => {
    const html = appendUnsubscribeFooter("<p>Hi</p>", url, {
      note: 'Acme <b>Inc</b> & Co'
    })!;
    expect(html).toContain("Acme &lt;b&gt;Inc&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>Inc</b>");
    // Note precedes the link.
    expect(html.indexOf("Acme")).toBeLessThan(html.indexOf("Unsubscribe</a>"));
  });

  it("turns newlines in the note into line breaks", () => {
    const html = appendUnsubscribeFooter("<p>Hi</p>", url, {
      note: "Acme Inc\n400 Market St"
    })!;
    expect(html).toContain("Acme Inc<br />400 Market St");
  });

  it("omits the note block when there is no note", () => {
    const html = appendUnsubscribeFooter("<p>Hi</p>", url, { note: null })!;
    expect(html).toContain("Unsubscribe</a>");
    expect(html).not.toContain("margin:0 0 8px");
  });

  it("puts the note in the plaintext footer too", () => {
    expect(
      appendUnsubscribeFooterText("Hello", url, { note: "Acme Inc" })
    ).toBe(`Hello\n\n--\nAcme Inc\n\nUnsubscribe: ${url}\n`);
  });
});
