import { beforeEach, expect, it, vi } from "vitest";
import { replyBackupKey } from "./reply-backup.js";
const base = "qqueue.reply.user.org.message";
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("finds a reply's backup when it was opened from a Drafts deep link", () => {
  localStorage.setItem(
    `${base}.draft1`,
    JSON.stringify({ html: "Unsent offline writing", draftId: "draft1" })
  );
  expect(replyBackupKey("user", "org", "message")).toBe(`${base}.draft1`);
});
it("opens an explicit draft's existing ordinary-entry backup without mixing another draft", () => {
  localStorage.setItem(
    base,
    JSON.stringify({ html: "Unsent writing", draftId: "draft1" })
  );
  expect(replyBackupKey("user", "org", "message", "draft1")).toBe(base);
  expect(replyBackupKey("user", "org", "message", "draft2")).toBe(
    `${base}.draft2`
  );
});
it("finds the most recent message backup while ignoring damaged and other-user writing", () => {
  localStorage.setItem(
    base,
    JSON.stringify({ html: "older", updatedAt: "2026-10-14" })
  );
  localStorage.setItem(
    `${base}.newer`,
    JSON.stringify({ html: "latest", updatedAt: "2026-10-15" })
  );
  localStorage.setItem(`${base}.broken`, "{broken");
  localStorage.setItem(
    "qqueue.reply.another.org.message",
    JSON.stringify({ html: "private", updatedAt: "2026-10-16" })
  );
  expect(replyBackupKey("user", "org", "message")).toBe(`${base}.newer`);
});
it("preserves a known backup identity when browser storage cannot be read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  expect(replyBackupKey("user", "org", "message", "draft")).toBe(
    `${base}.draft`
  );
});

it("chooses the latest tab copy for an explicit draft while preserving every other copy", () => {
  localStorage.setItem(
    `${base}.draft1`,
    JSON.stringify({
      html: "legacy",
      draftId: "draft1",
      updatedAt: "2026-10-14",
    })
  );
  localStorage.setItem(
    `${base}.tab.one`,
    JSON.stringify({ html: "one", draftId: "draft1", updatedAt: "2026-10-15" })
  );
  localStorage.setItem(
    `${base}.tab.two`,
    JSON.stringify({ html: "two", draftId: "draft1", updatedAt: "2026-10-16" })
  );
  localStorage.setItem(
    `${base}.tab.otherDraft`,
    JSON.stringify({
      html: "different",
      draftId: "draft2",
      updatedAt: "2026-10-17",
    })
  );
  expect(replyBackupKey("user", "org", "message", "draft1")).toBe(
    `${base}.tab.two`
  );
  expect(JSON.parse(localStorage.getItem(`${base}.tab.one`)!)).toMatchObject({
    html: "one",
  });
});
