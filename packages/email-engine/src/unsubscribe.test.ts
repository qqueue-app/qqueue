import { describe, expect, it } from "vitest";
import {
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
