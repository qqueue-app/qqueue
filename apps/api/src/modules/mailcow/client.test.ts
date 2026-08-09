import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailcowClient } from "./client.js";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = new MailcowClient({
  apiUrl: "https://mail.example.test/",
  apiKey: "key-123",
});

describe("MailcowClient", () => {
  it("sends the API key header and strips the trailing slash", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await client.listDomains();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://mail.example.test/api/v1/get/domain/all");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(
      "key-123"
    );
  });

  it("parses domains and normalizes Mailcow's 0/1 active flag", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          domain_name: "ACME.test",
          active: 1,
          description: "Primary",
          mboxes_in_domain: "3",
          max_num_mboxes_for_domain: 10,
          def_quota_for_mbox: "1073741824",
          max_quota_for_mbox: 2147483648,
          backupmx: 0,
        },
        { domain_name: "old.test", active: "0" },
        { not_a_domain: true },
      ])
    );

    await expect(client.listDomains()).resolves.toEqual([
      {
        // Lowercased, because every caller compares against a lowercase domain.
        domain_name: "acme.test",
        active: true,
        description: "Primary",
        mailboxCount: 3,
        maxMailboxes: 10,
        defaultQuotaBytes: 1073741824,
        maxQuotaBytes: 2147483648,
        backupmx: false,
      },
      // Absent fields read as 0/""; Mailcow omits them on older versions.
      {
        domain_name: "old.test",
        active: false,
        description: "",
        mailboxCount: 0,
        maxMailboxes: 0,
        defaultQuotaBytes: 0,
        maxQuotaBytes: 0,
        backupmx: false,
      },
    ]);
  });

  it("creates a domain and defaults it to active", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success" }]));

    await client.createDomain("acme.test", { description: "Primary" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/add/domain");
    expect(JSON.parse(init.body as string)).toEqual({
      domain: "acme.test",
      active: "1",
      description: "Primary",
    });
  });

  // Mailcow reads 0 as "unlimited" on every quota field, so a knob the caller
  // never set must not travel as a zero — that would strip the server's limits.
  it("omits unset domain attributes rather than sending zeros", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success" }]));

    await client.createDomain("acme.test");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ domain: "acme.test", active: "1" });
    expect(body).not.toHaveProperty("defquota");
    expect(body).not.toHaveProperty("maxquota");
    expect(body).not.toHaveProperty("mailboxes");
  });

  it("sends only the supplied attributes when editing a domain", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success" }]));

    await client.updateDomain("acme.test", {
      defaultQuotaMiB: 2048,
      active: false,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/edit/domain");
    expect(JSON.parse(init.body as string)).toEqual({
      items: ["acme.test"],
      attr: { defquota: "2048", active: "0" },
    });
  });

  it("skips the request entirely when an edit changes nothing", async () => {
    await client.updateDomain("acme.test", {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a DKIM key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        dkim_selector: "dkim",
        dkim_txt: "v=DKIM1;k=rsa;t=s;s=email;p=MIIBpub",
        length: "2048",
      })
    );

    await expect(client.getDkim("acme.test")).resolves.toEqual({
      selector: "dkim",
      txtValue: "v=DKIM1;k=rsa;t=s;s=email;p=MIIBpub",
      keySize: 2048,
    });
  });

  // Mailcow answers a keyless domain with an empty string, an empty array or
  // `false` depending on version — never a 404.
  it.each([[""], [[]], [false], [{ dkim_txt: "" }]])(
    "reads %p as no DKIM key",
    async (body) => {
      fetchMock.mockResolvedValue(jsonResponse(body));

      await expect(client.getDkim("acme.test")).resolves.toBeNull();
    }
  );

  it("generates a DKIM key with an explicit selector and size", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success" }]));

    await client.generateDkim("acme.test");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/add/dkim");
    expect(JSON.parse(init.body as string)).toEqual({
      domains: "acme.test",
      dkim_selector: "dkim",
      key_size: "2048",
    });
  });

  it("deletes a domain by name", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success" }]));

    await client.deleteDomain("acme.test");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/delete/domain");
    expect(JSON.parse(init.body as string)).toEqual(["acme.test"]);
  });

  it("treats a 200 body with only danger entries as an error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { type: "danger", msg: ["object_exists", "bob@acme.test"] },
      ])
    );

    await expect(
      client.createMailbox({
        localPart: "bob",
        domain: "acme.test",
        password: "pw",
      })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("object_exists"),
    });
  });

  it("succeeds when Mailcow reports success", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success", msg: "ok" }]));

    await expect(
      client.deleteMailbox("bob@acme.test")
    ).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual(["bob@acme.test"]);
  });

  it("maps auth rejections to mailcow_auth_failed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));

    await expect(client.listDomains()).rejects.toMatchObject({
      statusCode: 502,
      code: "mailcow_auth_failed",
    });
  });

  it("maps network failures to mailcow_unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(client.listDomains()).rejects.toMatchObject({
      statusCode: 502,
      code: "mailcow_unreachable",
    });
  });

  it("parses mailboxes, coercing Mailcow's string-or-number fields", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          username: "Ama@Acme.Test",
          name: "Ama",
          active: 1,
          quota: "1073741824",
          quota_used: 2048,
        },
        { username: "old@acme.test", name: "Old", active: "0" },
        { no_username: true },
      ])
    );

    await expect(client.listMailboxes()).resolves.toEqual([
      {
        email: "ama@acme.test",
        name: "Ama",
        active: true,
        quotaBytes: 1073741824,
        usedBytes: 2048,
      },
      // Missing numbers read as 0, which is Mailcow's "unlimited" for a quota.
      {
        email: "old@acme.test",
        name: "Old",
        active: false,
        quotaBytes: 0,
        usedBytes: 0,
      },
    ]);
  });

  it("scopes the mailbox listing to one domain when asked", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await client.listMailboxes("acme.test");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://mail.example.test/api/v1/get/mailbox/all/acme.test"
    );
  });

  // Mailcow answers an unknown domain with a non-array body rather than a 404.
  it("reads a non-array mailbox body as no mailboxes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await expect(client.listMailboxes("nope.test")).resolves.toEqual([]);
  });

  it("toggles a mailbox active flag as Mailcow's 0/1 string", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success" }]));

    await client.setMailboxActive("bob@acme.test", false);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/edit/mailbox");
    expect(JSON.parse(init.body as string)).toEqual({
      items: ["bob@acme.test"],
      attr: { active: "0" },
    });
  });

  // Asserted whole, not with `toMatchObject`: the label previously went out as
  // `app_passwd_name`, which Mailcow ignores and then rejects the call for an
  // empty `app_name`. A partial match let that ship, so pin every key.
  it("sends app-password requests with SMTP and IMAP protocol access", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ type: "success" }]));

    await client.createAppPassword({
      email: "bob@acme.test",
      name: "QQueue",
      password: "app-pw",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/add/app-passwd");
    expect(JSON.parse(init.body as string)).toEqual({
      active: "1",
      username: "bob@acme.test",
      app_name: "QQueue",
      app_passwd: "app-pw",
      app_passwd2: "app-pw",
      protocols: ["smtp_access", "imap_access"],
    });
  });
});
