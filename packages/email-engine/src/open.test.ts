import { describe, expect, it } from "vitest";
import { AUTOMATED_OPEN_WINDOW_SECONDS, classifyOpen } from "./open.js";

const GMAIL_PROXY =
  "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
const APPLE_MAIL =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

describe("classifyOpen", () => {
  it("treats a caching image proxy as a person, not a machine", () => {
    // Gmail fetches through its proxy *because* a human displayed the message.
    // Classifying it as automated would erase every Gmail recipient's opens.
    expect(classifyOpen({ userAgent: GMAIL_PROXY, secondsSinceSent: 900 })).toEqual({
      automated: false
    });
  });

  it("treats an ordinary mail client as a person", () => {
    expect(classifyOpen({ userAgent: APPLE_MAIL, secondsSinceSent: 900 })).toEqual({
      automated: false
    });
  });

  it.each([
    ["Proofpoint-Urldefense/1.0", "a security gateway"],
    ["Mimecast/2.0", "a link scanner"],
    ["BarracudaCentral", "an appliance"],
    ["Mozilla/5.0 (compatible; SafeLinks)", "Outlook link protection"]
  ])("flags %s (%s) as automated", (userAgent) => {
    expect(classifyOpen({ userAgent, secondsSinceSent: 900 })).toEqual({
      automated: true,
      reason: "scanner"
    });
  });

  it.each([
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
    "Mozilla/5.0 (compatible; Discordbot/2.0)",
    "SkypeUriPreview Preview/0.5"
  ])("flags the link-preview crawler %s as automated", (userAgent) => {
    expect(classifyOpen({ userAgent, secondsSinceSent: 900 }).automated).toBe(true);
  });

  it.each([
    "curl/8.4.0",
    "python-requests/2.31.0",
    "Go-http-client/1.1",
    "node-fetch/1.0"
  ])("flags the raw HTTP client %s as automated", (userAgent) => {
    expect(classifyOpen({ userAgent, secondsSinceSent: 900 })).toEqual({
      automated: true,
      reason: "scanner"
    });
  });

  it("flags a missing User-Agent as automated", () => {
    expect(classifyOpen({ secondsSinceSent: 900 })).toEqual({
      automated: true,
      reason: "no-user-agent"
    });
    expect(classifyOpen({ userAgent: "   ", secondsSinceSent: 900 })).toEqual({
      automated: true,
      reason: "no-user-agent"
    });
  });

  it("flags an open inside the pre-fetch window as automated", () => {
    // Apple Mail Privacy Protection presents an ordinary Mac Mail agent, so
    // timing is the only thing separating it from a reader.
    expect(
      classifyOpen({ userAgent: APPLE_MAIL, secondsSinceSent: 2 })
    ).toEqual({ automated: true, reason: "prefetch" });
    expect(
      classifyOpen({
        userAgent: APPLE_MAIL,
        secondsSinceSent: AUTOMATED_OPEN_WINDOW_SECONDS
      }).automated
    ).toBe(true);
  });

  it("stops flagging once the window has passed", () => {
    expect(
      classifyOpen({
        userAgent: APPLE_MAIL,
        secondsSinceSent: AUTOMATED_OPEN_WINDOW_SECONDS + 1
      })
    ).toEqual({ automated: false });
  });

  it("judges on User-Agent alone when the send time is unknown", () => {
    expect(classifyOpen({ userAgent: APPLE_MAIL, secondsSinceSent: null })).toEqual({
      automated: false
    });
    expect(classifyOpen({ userAgent: "curl/8.4.0" }).automated).toBe(true);
  });

  it("ignores a negative elapsed time rather than trusting a skewed clock", () => {
    expect(
      classifyOpen({ userAgent: APPLE_MAIL, secondsSinceSent: -30 })
    ).toEqual({ automated: false });
  });
});
