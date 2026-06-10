import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api.js";
import { getSession, saveSession } from "./session.js";

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    status,
    ok: init.ok ?? (status >= 200 && status < 300),
    json: () => Promise.resolve(body)
  } as unknown as Response;
}

describe("api lib", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the data envelope on success", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: "org_1", name: "Acme" }] })
    );

    const result = await api.listOrganizations();
    expect(result).toEqual([{ id: "org_1", name: "Acme" }]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/organizations");
    expect(options.headers["Content-Type"]).toBe("application/json");
    // no token stored -> no Authorization header
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("attaches the bearer token when a session exists", async () => {
    saveSession({ organizations: [], accessToken: "tok_123" });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await api.listContacts("org_1");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("organizationId=org_1");
    expect(options.headers.Authorization).toBe("Bearer tok_123");
  });

  it("encodes query parameters", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await api.listTemplates("org with space");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("organizationId=org%20with%20space");
  });

  it("sends a JSON body for POST requests", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: "c1" } }));
    await api.createContact({ email: "a@b.com" });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ email: "a@b.com" });
  });

  it("returns undefined for 204 responses", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
    const result = await api.deleteContact("c1");
    expect(result).toBeUndefined();
  });

  it("throws ApiError with the server error message", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "Nope" } }, { status: 400 })
    );
    await expect(api.createContact({})).rejects.toMatchObject({
      message: "Nope",
      status: 400,
      name: "ApiError"
    });
  });

  it("formats zod issue errors into a field message", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            issues: [
              { path: ["body", "email"], message: "Invalid email" },
              { path: [], message: "Generic" }
            ]
          }
        },
        { status: 422 }
      )
    );
    try {
      await api.createContact({});
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toBe(
        "body.email: Invalid email; Generic"
      );
      expect((error as ApiError).issues).toHaveLength(2);
    }
  });

  it("falls back to a generic message when there is no error body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 500 }));
    await expect(api.listOrganizations()).rejects.toMatchObject({
      message: "Request failed (500)",
      status: 500
    });
  });

  it("uses issue message without a field path", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { issues: [{ message: "Bad" }] } },
        { status: 400 }
      )
    );
    await expect(api.listOrganizations()).rejects.toMatchObject({
      message: "Bad"
    });
  });

  it("throws a reachability error when fetch rejects", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(api.listOrganizations()).rejects.toMatchObject({
      message: "Cannot reach the API. Is the server running?",
      status: 0
    });
  });

  it("refreshes the token on a 401 and retries the request", async () => {
    saveSession({
      organizations: [],
      accessToken: "old",
      refreshToken: "refresh_1"
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // first call -> 401
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 401 }));
    // refresh call -> new tokens
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: { tokens: { accessToken: "new", refreshToken: "refresh_2" } }
      })
    );
    // retried original call -> success
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: "o" }] }));

    const result = await api.listOrganizations();
    expect(result).toEqual([{ id: "o" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // tokens were persisted
    expect(getSession().accessToken).toBe("new");
    // retried call carried the refreshed token
    const retryHeaders = fetchMock.mock.calls[2][1].headers;
    expect(retryHeaders.Authorization).toBe("Bearer new");
  });

  it("redirects to login when refresh fails", async () => {
    saveSession({
      organizations: [],
      accessToken: "old",
      refreshToken: "refresh_1"
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 401 }));
    // refresh fails
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 401 }));
    // the original 401 body is then read and thrown
    // (the second mock above doubles as both refresh fail and re-read)

    const hrefSetter = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/dashboard", set href(v: string) { hrefSetter(v); } }
    });

    await expect(api.listOrganizations()).rejects.toBeInstanceOf(ApiError);
    expect(hrefSetter).toHaveBeenCalledWith("/login");
    expect(getSession().accessToken).toBeUndefined();

    Object.defineProperty(window, "location", {
      configurable: true,
      value: original
    });
  });

  it("does not refresh on a 401 from an auth endpoint", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "Bad creds" } }, { status: 401 })
    );
    await expect(
      api.login({ email: "a@b.com", password: "x" })
    ).rejects.toMatchObject({ message: "Bad creds", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh when there is no refresh token", async () => {
    saveSession({ organizations: [], accessToken: "old" });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 401 }));

    const hrefSetter = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/dashboard", set href(v: string) { hrefSetter(v); } }
    });

    await expect(api.listOrganizations()).rejects.toBeInstanceOf(ApiError);
    expect(hrefSetter).toHaveBeenCalledWith("/login");
    // only the original request, no refresh call
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: original
    });
  });

  it("does not redirect when already on the login page", async () => {
    saveSession({ organizations: [], accessToken: "old" });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 401 }));

    const hrefSetter = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/login", set href(v: string) { hrefSetter(v); } }
    });

    await expect(api.listOrganizations()).rejects.toBeInstanceOf(ApiError);
    expect(hrefSetter).not.toHaveBeenCalled();

    Object.defineProperty(window, "location", {
      configurable: true,
      value: original
    });
  });

  it("exercises the remaining endpoint builders", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: "x" } }));

    await api.dashboardSummary("org_1");
    await api.register({ email: "a@b.com", password: "p" });
    await api.createOrganization({ name: "A" });
    await api.listSMTPConnections("org_1");
    await api.createSMTPConnection({ name: "s" });
    await api.updateSMTPConnection("s1", { name: "s" });
    await api.deleteSMTPConnection("s1");
    await api.updateContact("c1", {});
    await api.listContactLists("org_1");
    await api.createContactList({});
    await api.updateContactList("l1", {});
    await api.deleteContactList("l1");
    await api.createTemplate({});
    await api.updateTemplate("t1", {});
    await api.deleteTemplate("t1");
    await api.listCampaigns("org_1");
    await api.campaignAnalytics("cmp1");
    await api.createCampaign({});
    await api.updateCampaign("cmp1", {});
    await api.duplicateCampaign("cmp1");
    await api.deleteCampaign("cmp1");
    await api.sendCampaignNow("cmp1");
    await api.scheduleCampaign("cmp1", "2026-01-01");
    await api.setCampaignRecurrence("cmp1", {
      cronExpression: "* * * * *",
      timezone: "UTC"
    });
    await api.pauseCampaign("cmp1");
    await api.resumeCampaign("cmp1");
    await api.sendEmail({ to: "a@b.com" });
    await api.listApiKeys("org_1");
    await api.createApiKey({ organizationId: "org_1", name: "SDK" });
    await api.revokeApiKey("key_1");
    await api.listWebhookEndpoints("org_1");
    await api.createWebhookEndpoint({
      organizationId: "org_1",
      name: "App",
      url: "https://example.com/webhooks/qqueue",
      events: ["email.sent"]
    });
    await api.deleteWebhookEndpoint("wh_1");

    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls.some((u: string) => u.includes("/dashboard/summary"))).toBe(true);
    expect(urls.some((u: string) => u.includes("/campaigns/cmp1/analytics"))).toBe(
      true
    );
    expect(
      urls.some((u: string) => u.includes("/transactional-email/send"))
    ).toBe(true);
    expect(urls.some((u: string) => u.includes("/api-keys"))).toBe(true);
    expect(urls.some((u: string) => u.includes("/webhook-endpoints"))).toBe(true);
  });
});
