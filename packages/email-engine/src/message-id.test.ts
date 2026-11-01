import { describe, expect, it } from "vitest";
import { buildMessageId } from "./message-id.js";

describe("buildMessageId", () => {
  it("uses the sending address's domain", () => {
    expect(buildMessageId("abc", "Alerts@Notify.ChaleCheck.com")).toBe(
      "<abc@notify.chalecheck.com>"
    );
  });

  it("falls back to a reserved domain for an address without one", () => {
    expect(buildMessageId("abc", "broken")).toBe("<abc@qqueue.invalid>");
  });
});
