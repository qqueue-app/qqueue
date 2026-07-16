import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiBaseUrl, ApiError } from "./api.js";
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
    await api.requestPasswordReset({ email: "a@b.com" });
    await api.resetPassword({
      token: "reset_token_123456789012345678901234567890",
      password: "password123"
    });
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
    await api.queueOperations();
    await api.retryQueueJob("email-sending", "job_1");

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
    expect(urls.some((u: string) => u.includes("/queue-operations"))).toBe(true);
  });
});

// The wrappers below are thin URL/verb builders over request(). Rather than a
// bespoke test each, table-drive them: every row pins the exact URL and method
// the endpoint must produce, so a typo'd path or verb fails on its own row.
describe("api endpoint builders", () => {
  const ORG = "org_1";

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: { id: "x" } })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases: Array<{
    name: string;
    method: string;
    path: string;
    call: () => Promise<unknown>;
  }> = [
    // --- setup + instance settings ---
    { name: "setupStatus", method: "GET", path: "/api/v1/setup/status", call: () => api.setupStatus() },
    { name: "completeSetup", method: "POST", path: "/api/v1/setup/complete", call: () => api.completeSetup({ allowPublicRegistration: true }) },
    { name: "getInstanceSettings", method: "GET", path: "/api/v1/instance-settings", call: () => api.getInstanceSettings() },
    { name: "updateInstanceSettings", method: "PATCH", path: "/api/v1/instance-settings", call: () => api.updateInstanceSettings({ allowPublicRegistration: false }) },
    { name: "instanceEnvStatus", method: "GET", path: "/api/v1/instance-settings/env-status", call: () => api.instanceEnvStatus() },

    // --- organizations + members ---
    { name: "updateOrganization", method: "PUT", path: "/api/v1/organizations/org_1", call: () => api.updateOrganization(ORG, { name: "Acme" }) },
    { name: "listOrganizationMembers", method: "GET", path: "/api/v1/organizations/org_1/members", call: () => api.listOrganizationMembers(ORG) },
    { name: "updateMemberRole", method: "PATCH", path: "/api/v1/organizations/org_1/members/usr_1", call: () => api.updateMemberRole(ORG, "usr_1", "ADMIN") },
    { name: "removeMember", method: "DELETE", path: "/api/v1/organizations/org_1/members/usr_1", call: () => api.removeMember(ORG, "usr_1") },

    // --- invitations ---
    { name: "listInvites", method: "GET", path: "/api/v1/invitations?organizationId=org_1", call: () => api.listInvites(ORG) },
    { name: "createInvite", method: "POST", path: "/api/v1/invitations", call: () => api.createInvite({ organizationId: ORG, email: "a@b.com", role: "MEMBER" }) },
    { name: "revokeInvite", method: "DELETE", path: "/api/v1/invitations/inv_1", call: () => api.revokeInvite("inv_1") },
    { name: "lookupInvite", method: "GET", path: "/api/v1/invitations/lookup?token=tok_1", call: () => api.lookupInvite("tok_1") },
    { name: "acceptInvite", method: "POST", path: "/api/v1/invitations/accept", call: () => api.acceptInvite({ token: "tok_1", password: "password123" }) },

    // --- contacts + segments ---
    { name: "previewSegment", method: "POST", path: "/api/v1/contacts/segment/preview", call: () => api.previewSegment({ organizationId: ORG }) },
    { name: "createListFromSegment", method: "POST", path: "/api/v1/contact-lists/from-segment", call: () => api.createListFromSegment({ organizationId: ORG }) },
    { name: "listSegments", method: "GET", path: "/api/v1/segments?organizationId=org_1", call: () => api.listSegments(ORG) },
    { name: "createSegment", method: "POST", path: "/api/v1/segments", call: () => api.createSegment({ organizationId: ORG }) },
    { name: "updateSegment", method: "PUT", path: "/api/v1/segments/seg_1", call: () => api.updateSegment("seg_1", {}) },
    { name: "deleteSegment", method: "DELETE", path: "/api/v1/segments/seg_1", call: () => api.deleteSegment("seg_1") },
    { name: "previewSegmentRules", method: "POST", path: "/api/v1/segments/preview", call: () => api.previewSegmentRules({ organizationId: ORG, rules: {} }) },

    // --- suppressions ---
    { name: "listSuppressions", method: "GET", path: "/api/v1/suppressions?organizationId=org_1", call: () => api.listSuppressions(ORG) },
    { name: "addSuppression", method: "POST", path: "/api/v1/suppressions", call: () => api.addSuppression({ organizationId: ORG, email: "a@b.com", reason: "MANUAL" }) },
    { name: "deleteSuppression", method: "DELETE", path: "/api/v1/suppressions/sup_1", call: () => api.deleteSuppression("sup_1") },
    { name: "getSuppressionPolicy", method: "GET", path: "/api/v1/suppressions/policy?organizationId=org_1", call: () => api.getSuppressionPolicy(ORG) },
    { name: "updateSuppressionPolicy", method: "PUT", path: "/api/v1/suppressions/policy", call: () => api.updateSuppressionPolicy({ organizationId: ORG, hardBounceSuppress: true }) },

    // --- domain throttles ---
    { name: "listDomainThrottles", method: "GET", path: "/api/v1/domain-throttles?organizationId=org_1", call: () => api.listDomainThrottles(ORG) },
    { name: "upsertDomainThrottle", method: "PUT", path: "/api/v1/domain-throttles", call: () => api.upsertDomainThrottle({ organizationId: ORG, domain: "gmail.com", maxPerMinute: 10 }) },
    { name: "deleteDomainThrottle", method: "DELETE", path: "/api/v1/domain-throttles/thr_1", call: () => api.deleteDomainThrottle("thr_1") },

    // --- deliverability ---
    { name: "deliverabilityOverview", method: "GET", path: "/api/v1/deliverability/overview?organizationId=org_1", call: () => api.deliverabilityOverview(ORG) },
    { name: "deliverabilityDomains", method: "GET", path: "/api/v1/deliverability/domains?organizationId=org_1", call: () => api.deliverabilityDomains(ORG) },
    { name: "deliverabilityAlerts", method: "GET", path: "/api/v1/deliverability/alerts?organizationId=org_1", call: () => api.deliverabilityAlerts(ORG) },

    // --- templates ---
    { name: "getTemplate", method: "GET", path: "/api/v1/templates/tpl_1", call: () => api.getTemplate("tpl_1") },
    { name: "cloneTemplate", method: "POST", path: "/api/v1/templates/tpl_1/clone", call: () => api.cloneTemplate("tpl_1") },
    { name: "previewTemplate", method: "POST", path: "/api/v1/templates/preview", call: () => api.previewTemplate({ organizationId: ORG, subject: "Hi" }) },
    { name: "testSendTemplate", method: "POST", path: "/api/v1/templates/tpl_1/test", call: () => api.testSendTemplate("tpl_1", { organizationId: ORG, to: "a@b.com" }) },

    // --- campaigns ---
    { name: "configureAbTest", method: "PUT", path: "/api/v1/campaigns/cmp_1/ab-test", call: () => api.configureAbTest("cmp_1", {}) },

    // --- manual email ---
    { name: "sendManualEmail", method: "POST", path: "/api/v1/manual-email/send", call: () => api.sendManualEmail({ organizationId: ORG }) },
    { name: "previewEmail", method: "POST", path: "/api/v1/manual-email/preview", call: () => api.previewEmail({ organizationId: ORG }) },
    { name: "manualEmailStatus", method: "GET", path: "/api/v1/manual-email/job_1/status?organizationId=org_1", call: () => api.manualEmailStatus("job_1", ORG) },

    // --- attachments ---
    { name: "deleteAttachment", method: "DELETE", path: "/api/v1/attachments/att_1", call: () => api.deleteAttachment("att_1") },

    // --- drafts ---
    { name: "listEmailDrafts", method: "GET", path: "/api/v1/email-drafts?organizationId=org_1", call: () => api.listEmailDrafts(ORG) },
    { name: "getEmailDraft", method: "GET", path: "/api/v1/email-drafts/dft_1", call: () => api.getEmailDraft("dft_1") },
    { name: "createEmailDraft", method: "POST", path: "/api/v1/email-drafts", call: () => api.createEmailDraft({ organizationId: ORG }) },
    { name: "updateEmailDraft", method: "PUT", path: "/api/v1/email-drafts/dft_1", call: () => api.updateEmailDraft("dft_1", {}) },
    { name: "deleteEmailDraft", method: "DELETE", path: "/api/v1/email-drafts/dft_1", call: () => api.deleteEmailDraft("dft_1") },

    // --- inbox ---
    { name: "listInboxAccounts", method: "GET", path: "/api/v1/inbox/accounts?organizationId=org_1", call: () => api.listInboxAccounts(ORG) },
    { name: "createInboxAccount", method: "POST", path: "/api/v1/inbox/accounts", call: () => api.createInboxAccount({ organizationId: ORG }) },
    { name: "updateInboxAccount", method: "PATCH", path: "/api/v1/inbox/accounts/acc_1?organizationId=org_1", call: () => api.updateInboxAccount("acc_1", { organizationId: ORG }) },
    { name: "deleteInboxAccount", method: "DELETE", path: "/api/v1/inbox/accounts/acc_1?organizationId=org_1", call: () => api.deleteInboxAccount("acc_1", ORG) },
    { name: "markInboundMessageRead", method: "PATCH", path: "/api/v1/inbox/messages/msg_1/read?organizationId=org_1", call: () => api.markInboundMessageRead("msg_1", { organizationId: ORG, read: true }) },
    { name: "replyToInboundMessage", method: "POST", path: "/api/v1/inbox/messages/msg_1/reply?organizationId=org_1", call: () => api.replyToInboundMessage("msg_1", { organizationId: ORG, subject: "Re: hi" }) },

    // --- webhooks ---
    { name: "listWebhookDeliveries", method: "GET", path: "/api/v1/webhook-endpoints/wh_1/deliveries", call: () => api.listWebhookDeliveries("wh_1") },
    { name: "retryWebhookDelivery", method: "POST", path: "/api/v1/webhook-endpoints/deliveries/del_1/retry", call: () => api.retryWebhookDelivery("del_1") }
  ];

  it.each(cases)("$name issues $method $path", async ({ call, method, path }) => {
    await call();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${apiBaseUrl}${path}`);
    // request() leaves method unset for reads.
    expect(options.method ?? "GET").toBe(method);
  });
});

describe("api query-string builders", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: { id: "x" } })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function lastUrl() {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls.at(-1)![0] as string;
  }

  it("omits the activity query entirely when no options are given", async () => {
    await api.getContactActivity("c1");
    expect(lastUrl()).toBe(`${apiBaseUrl}/api/v1/contacts/c1/activity`);
  });

  it("builds the activity query from cursor and limit", async () => {
    await api.getContactActivity("c1", { cursor: "cur_1", limit: 25 });
    expect(lastUrl()).toBe(
      `${apiBaseUrl}/api/v1/contacts/c1/activity?cursor=cur_1&limit=25`
    );
  });

  it("includes only the inbound filters that are set", async () => {
    await api.listInboundMessages({ organizationId: "org_1" });
    expect(lastUrl()).toBe(`${apiBaseUrl}/api/v1/inbox/messages?organizationId=org_1`);

    await api.listInboundMessages({
      organizationId: "org_1",
      q: "invoice due",
      read: "unread",
      cursor: "cur_1"
    });
    expect(lastUrl()).toBe(
      `${apiBaseUrl}/api/v1/inbox/messages?organizationId=org_1&q=invoice+due&read=unread&cursor=cur_1`
    );
  });

  it("falls back to an empty organizationId when the inbox patch omits it", async () => {
    await api.updateInboxAccount("acc_1", { name: "Support" });
    expect(lastUrl()).toBe(`${apiBaseUrl}/api/v1/inbox/accounts/acc_1?organizationId=`);
  });
});

describe("api multipart uploads", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: { id: "x" } })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function lastCall() {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls.at(-1)! as [string, RequestInit];
  }

  const csv = () => new File(["email\na@b.com"], "contacts.csv", { type: "text/csv" });
  const png = () => new File(["binary"], "logo.png", { type: "image/png" });

  it("posts contact imports as multipart without forcing a JSON content type", async () => {
    await api.importContacts(csv(), { organizationId: "org_1" });
    const [url, options] = lastCall();
    expect(url).toBe(`${apiBaseUrl}/api/v1/contacts/import`);
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    // FormData must set its own multipart boundary.
    expect((options.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const form = options.body as FormData;
    expect(form.get("organizationId")).toBe("org_1");
    expect(form.get("contactListId")).toBeNull();
  });

  it("includes the target list on a contact import when given", async () => {
    await api.importContacts(csv(), { organizationId: "org_1", contactListId: "lst_1" });
    const form = lastCall()[1].body as FormData;
    expect(form.get("contactListId")).toBe("lst_1");
  });

  it("uploads an attachment, optionally bound to a draft", async () => {
    await api.uploadAttachment(png(), { organizationId: "org_1" });
    let [url, options] = lastCall();
    expect(url).toBe(`${apiBaseUrl}/api/v1/attachments`);
    expect((options.body as FormData).get("emailDraftId")).toBeNull();

    await api.uploadAttachment(png(), { organizationId: "org_1", emailDraftId: "dft_1" });
    [url, options] = lastCall();
    expect((options.body as FormData).get("emailDraftId")).toBe("dft_1");
  });

  it("uploads an image", async () => {
    await api.uploadImage(png(), { organizationId: "org_1" });
    const [url, options] = lastCall();
    expect(url).toBe(`${apiBaseUrl}/api/v1/images`);
    expect(options.method).toBe("POST");
    expect((options.body as FormData).get("organizationId")).toBe("org_1");
  });
});

describe("api.exportContacts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function csvResponse(text: string, init: { status?: number; ok?: boolean } = {}) {
    const status = init.status ?? 200;
    return {
      status,
      ok: init.ok ?? (status >= 200 && status < 300),
      text: () => Promise.resolve(text)
    } as unknown as Response;
  }

  it("returns raw CSV text rather than a JSON envelope", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(csvResponse("email\na@b.com"));

    const result = await api.exportContacts("org_1");
    expect(result).toBe("email\na@b.com");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${apiBaseUrl}/api/v1/contacts/export?organizationId=org_1`
    );
  });

  it("scopes the export to a list and attaches the bearer token", async () => {
    saveSession({ organizations: [], accessToken: "tok_123" });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(csvResponse("email"));

    await api.exportContacts("org_1", "lst_1");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${apiBaseUrl}/api/v1/contacts/export?organizationId=org_1&contactListId=lst_1`
    );
    expect(options.headers.Authorization).toBe("Bearer tok_123");
  });

  it("sends no auth header when there is no session", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(csvResponse("email"));
    await api.exportContacts("org_1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("throws an ApiError when the export fails", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(csvResponse("", { status: 500 }));
    await expect(api.exportContacts("org_1")).rejects.toMatchObject({
      name: "ApiError",
      message: "Unable to export contacts",
      status: 500
    });
  });
});
