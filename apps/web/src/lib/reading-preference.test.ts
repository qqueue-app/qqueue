import { describe, expect, it, vi } from "vitest";
import {
  readingPreference,
  setReadingPreference,
} from "./reading-preference.js";
describe("mail reading preference", () => {
  it("defaults to a full-width list and retains an explicitly chosen pane", () => {
    expect(readingPreference("u1")).toBe("focused");
    setReadingPreference("u1", "pane");
    expect(readingPreference("u1")).toBe("pane");
    expect(readingPreference("u2")).toBe("focused");
    setReadingPreference("u1", "focused");
    expect(readingPreference("u1")).toBe("focused");
  });
  it("keeps mail available when browser storage is unavailable", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(readingPreference("u1")).toBe("focused");
    get.mockRestore();
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => setReadingPreference("u1", "pane")).not.toThrow();
    set.mockRestore();
  });
});
