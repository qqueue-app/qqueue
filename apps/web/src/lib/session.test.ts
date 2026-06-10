import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSession,
  getCurrentOrganizationId,
  getSession,
  saveSession,
  updateTokens
} from "./session.js";

beforeEach(() => {
  window.localStorage.clear();
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
      currentOrganizationId: "org_1"
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
      refreshToken: "old-refresh"
    });

    updateTokens({ accessToken: "new", refreshToken: "new-refresh" });

    const session = getSession();
    expect(session.accessToken).toBe("new");
    expect(session.refreshToken).toBe("new-refresh");
    expect(session.currentOrganizationId).toBe("org_1");
  });
});
