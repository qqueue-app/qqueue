import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}));
vi.mock("sonner", () => ({ toast }));

import { createQueryClient, qk } from "./query-client.js";

/**
 * Every org-scoped key must carry the organization id. That is what makes
 * switching organizations swap caches instead of showing one org's rows to
 * another, so it is asserted over the whole factory rather than per call site —
 * a new key added without an org id fails here instead of leaking in the UI.
 */
describe("qk query key factory", () => {
  // Builders keyed by something other than an organization (a single record, or
  // a genuinely global resource). Listed explicitly so adding an org-scoped key
  // and forgetting the org id can't pass by being silently skipped.
  const NOT_ORG_SCOPED = new Set([
    "connectionGrants",
    "contactActivity",
    "template",
    "campaignAnalytics",
    "draft",
    "webhookDeliveries",
    "organizations",
    "instanceSettings",
    "instanceEnvStatus",
    "pushPublicKey"
  ]);

  const orgScoped = Object.entries(qk).filter(
    ([name]) => !NOT_ORG_SCOPED.has(name)
  );

  it("covers every builder in the factory", () => {
    // Guards the two lists above against drift: if a key is added, it lands in
    // one bucket or the other rather than going untested.
    expect(orgScoped.length + NOT_ORG_SCOPED.size).toBe(
      Object.keys(qk).length
    );
  });

  it("carries the organization id in every org-scoped key", () => {
    for (const [name, build] of orgScoped) {
      expect(build("org_1"), `${name} should include the org id`).toContain(
        "org_1"
      );
    }
  });

  it("swaps the key when the organization changes", () => {
    for (const [name, build] of orgScoped) {
      expect(build("org_1"), `${name} should differ across orgs`).not.toEqual(
        build("org_2")
      );
    }
  });

  it("starts every key with a stable resource name", () => {
    for (const [name, build] of Object.entries(qk)) {
      const [head] = build("id_1");
      expect(typeof head, `${name} should lead with a string`).toBe("string");
      expect(head).not.toBe("");
    }
  });

  it("gives different resources different keys for the same id", () => {
    // Two resources sharing a key would serve one's response from the other's
    // cache entry.
    const keys = Object.entries(qk).map(
      ([name, build]) => [name, JSON.stringify(build("id_1"))] as const
    );
    const seen = new Map<string, string>();
    for (const [name, key] of keys) {
      const clash = seen.get(key);
      expect(clash, `${name} collides with ${clash}`).toBeUndefined();
      seen.set(key, name);
    }
  });

  it("keys inbound messages by their filters so a filtered view has its own cache", () => {
    expect(qk.inboundMessages("org_1", { unread: true })).not.toEqual(
      qk.inboundMessages("org_1", { unread: false })
    );
    // An absent filter set is still a stable key, not `undefined`.
    expect(qk.inboundMessages("org_1")).toEqual([
      "inbound-messages",
      "org_1",
      {}
    ]);
  });
});

describe("createQueryClient retry policy", () => {
  function retryFn() {
    const retry = createQueryClient().getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") {
      throw new Error("expected a retry predicate");
    }
    return retry;
  }

  it("does not retry a 4xx, which will not fix itself", () => {
    const retry = retryFn();
    for (const status of [400, 401, 403, 404, 422]) {
      expect(retry(0, { status }), `status ${status}`).toBe(false);
    }
  });

  it("retries a 5xx twice before giving up", () => {
    const retry = retryFn();
    expect(retry(0, { status: 500 })).toBe(true);
    expect(retry(1, { status: 503 })).toBe(true);
    expect(retry(2, { status: 500 })).toBe(false);
  });

  it("retries a network failure that carries no status", () => {
    const retry = retryFn();
    expect(retry(0, new Error("Failed to fetch"))).toBe(true);
    expect(retry(0, null)).toBe(true);
  });

  it("reads the status by shape, so an error from another module still counts", () => {
    // Not an ApiError instance — just something status-shaped.
    expect(retryFn()(0, { status: 403, message: "nope" })).toBe(false);
    // A non-numeric status is not a status.
    expect(retryFn()(0, { status: "403" })).toBe(true);
  });

  it("never retries mutations", () => {
    expect(
      createQueryClient().getDefaultOptions().mutations?.retry
    ).toBe(false);
  });
});

describe("createQueryClient failure toasts", () => {
  beforeEach(() => {
    toast.error.mockClear();
  });

  /** Drive the QueryCache's onError the way a failing query would. */
  function fireError(
    error: unknown,
    query: { meta?: Record<string, unknown>; state: { data?: unknown } }
  ) {
    const cache = createQueryClient().getQueryCache();
    const handler = cache.config.onError;
    handler?.(error, query as never);
  }

  it("reports a first load that failed with nothing to show", () => {
    fireError(new Error("boom"), { state: { data: undefined } });
    expect(toast.error).toHaveBeenCalledWith("boom");
  });

  it("falls back to a generic message when the error says nothing", () => {
    fireError({}, { state: { data: undefined } });
    expect(toast.error).toHaveBeenCalledWith("Couldn't load this page's data.");
  });

  it("stays quiet when the screen still shows good data", () => {
    // A background refetch failing behind a populated page is not worth
    // interrupting anyone over.
    fireError(new Error("boom"), { state: { data: [] } });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stays quiet for a query that opted out", () => {
    fireError(new Error("boom"), {
      meta: { silent: true },
      state: { data: undefined }
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
