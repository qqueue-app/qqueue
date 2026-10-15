import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  getCurrentOrganizationId,
  getSession,
  saveSession,
  updateTokens,
  subscribeSession,
  receiveSessionStorageChange,
} from "./session.js";

beforeEach(() => {
  window.localStorage.clear();
  clearSession();
});
afterEach(() => {
  vi.restoreAllMocks();
  clearSession();
});

describe("getSession", () => {
  it("returns an empty session when nothing is stored", () => {
    expect(getSession()).toEqual({ organizations: [] });
  });

  it("returns an empty session when the stored value is corrupt", () => {
    window.localStorage.setItem("qqueue.session", "{not json");
    expect(getSession()).toEqual({ organizations: [] });
  });

  it("parses a previously stored session", () => {
    saveSession({
      organizations: [{ id: "org_1", name: "Acme" }],
      currentOrganizationId: "org_1",
    });
    expect(getSession().currentOrganizationId).toBe("org_1");
  });
});

describe("clearSession", () => {
  it("removes the stored session", () => {
    saveSession({ organizations: [], accessToken: "t" });
    clearSession();
    expect(getSession().accessToken).toBeUndefined();
  });
});

describe("getCurrentOrganizationId", () => {
  it("reads the current org id from the session", () => {
    saveSession({ organizations: [], currentOrganizationId: "org_2" });
    expect(getCurrentOrganizationId()).toBe("org_2");
  });
});

describe("updateTokens", () => {
  it("updates tokens while preserving the rest of the session", () => {
    saveSession({
      organizations: [{ id: "org_1", name: "Acme" }],
      currentOrganizationId: "org_1",
      accessToken: "old",
      refreshToken: "old-refresh",
    });

    updateTokens({ accessToken: "new", refreshToken: "new-refresh" });

    const session = getSession();
    expect(session.accessToken).toBe("new");
    expect(session.refreshToken).toBe("new-refresh");
    expect(session.currentOrganizationId).toBe("org_1");
  });
});

describe("session continuity with unavailable browser storage", () => {
  it("keeps an authenticated window usable through token and organization changes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    const current = {
      user: { id: "owner", email: "owner@example.test" },
      organizations: [{ id: "org", name: "Org" }],
      currentOrganizationId: "org",
      accessToken: "old",
    };
    expect(saveSession(current)).toBe(false);
    updateTokens({ accessToken: "new", refreshToken: "new-refresh" });
    expect(getSession()).toMatchObject({
      user: current.user,
      currentOrganizationId: "org",
      accessToken: "new",
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(getSession().accessToken).toBe("new");
  });
  it("clears the active window even when storage removal fails", () => {
    saveSession({ organizations: [], accessToken: "old" });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    expect(clearSession()).toBe(false);
    expect(getSession()).toEqual({ organizations: [] });
  });
  it("publishes the latest refresh and peer sign-out once per microtask", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);
    saveSession({ organizations: [], accessToken: "one" });
    updateTokens({ accessToken: "two", refreshToken: "refresh" });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ accessToken: "two" })
    );
    receiveSessionStorageChange(null);
    await Promise.resolve();
    expect(listener).toHaveBeenLastCalledWith({ organizations: [] });
    unsubscribe();
  });
});
