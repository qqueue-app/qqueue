import { describe, expect, it } from "vitest";
import { selectConversationWindow } from "./conversation-window.js";
import { inboxConversationWindowSchema } from "@qqueue/shared";
const entries = Array.from({ length: 35 }, (_, index) => ({
  key: `received:${String(index).padStart(3, "0")}`,
  at: new Date(2026, 0, 1, 0, index),
}));
describe("bounded conversation bodies", () => {
  it("keeps an older deep-link anchor visible within ten bodies and offers both directions", () => {
    const page = selectConversationWindow(entries, "received:020", {});
    expect(page).toMatchObject({
      keys: entries.slice(11, 21).map((entry) => entry.key),
      before: "received:011",
      after: "received:020",
      total: 35,
      start: 12,
      end: 21,
    });
  });
  it("walks every earlier page without skipped or repeated identities despite new replies", () => {
    const latest = selectConversationWindow(entries, "received:034", {});
    const middle = selectConversationWindow(
      [...entries, { key: "sent:new", at: new Date(2027, 0, 1) }],
      "received:034",
      { before: latest.before! }
    );
    const earlier = selectConversationWindow(entries, "received:034", {
      before: middle.before!,
    });
    const first = selectConversationWindow(entries, "received:034", {
      before: earlier.before!,
    });
    expect([
      ...first.keys,
      ...earlier.keys,
      ...middle.keys,
      ...latest.keys,
    ]).toEqual(entries.map((entry) => entry.key));
    expect(first.before).toBeNull();
    expect(
      selectConversationWindow(entries, "received:034", {
        after: earlier.after!,
      }).keys
    ).toEqual(middle.keys);
  });
  it("rejects a cursor outside the authorized conversation and ambiguous input", () => {
    expect(() =>
      selectConversationWindow(entries, "received:034", {
        before: "received:foreign",
      })
    ).toThrow("page is unavailable");
    expect(
      inboxConversationWindowSchema.safeParse({ before: "one", after: "two" })
        .success
    ).toBe(false);
  });
  it("orders simultaneous incoming and outgoing identities consistently", () => {
    const at = new Date();
    expect(
      selectConversationWindow(
        [
          { key: "sent:a", at },
          { key: "received:b", at },
        ],
        "received:b",
        {}
      ).keys
    ).toEqual(["received:b", "sent:a"]);
  });
});
