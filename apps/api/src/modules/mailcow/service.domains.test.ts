import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

/**
 * Domain management and the ownership model that scopes it.
 *
 * Kept apart from service.test.ts, which covers mailbox provisioning: these
 * tests pin who may see and change a *domain* on a mail server that every org
 * on the instance shares. Before `OrgMailDomain` existed, every org OWNER saw
 * every server domain, so the ownership cases here are regression tests for
 * that leak rather than tests of a new feature.
 */

const h = vi.hoisted(() => ({
  client: {
    listDomains: vi.fn(),
    listMailboxes: vi.fn(),
    createDomain: vi.fn(),
    updateDomain: vi.fn(),
    deleteDomain: vi.fn(),
    getDkim: vi.fn(),
    generateDkim: vi.fn(),
  } as Record<string, ReturnType<typeof vi.fn>>,
  getMailcowClient: vi.fn(),
  mailcowMailHost: vi.fn(),
  verifyConnection: vi.fn(),
  buildDnsRecords: vi.fn(),
  checkDnsRecords: vi.fn(),
  detectDnsProvider: vi.fn(),
}));

vi.mock("./client.js", () => ({
  getMailcowClient: h.getMailcowClient,
  mailcowMailHost: h.mailcowMailHost,
}));

// DNS is stubbed wholesale: these tests pin orchestration and authorisation,
// and a real resolver would make them slow and network-dependent. dns.test.ts
// covers record building and matching.
vi.mock("./dns.js", () => ({
  buildDnsRecords: h.buildDnsRecords,
  checkDnsRecords: h.checkDnsRecords,
  detectDnsProvider: h.detectDnsProvider,
}));

vi.mock("../smtp-connections/service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../smtp-connections/service.js")
  >("../smtp-connections/service.js");
  return { ...actual, verifyConnection: h.verifyConnection };
});

const { mailcowService } = await import("./service.js");

const ownerActor = { organizationId: "org_1", userId: "owner_1", role: "OWNER" };
const adminActor = { organizationId: "org_1", userId: "admin_1", role: "ADMIN" };

const ACME = {
  domain_name: "acme.test",
  active: true,
  description: "Primary",
  mailboxCount: 2,
  maxMailboxes: 10,
  defaultQuotaBytes: 1024,
  maxQuotaBytes: 2048,
  backupmx: false,
};

beforeEach(() => {
  for (const fn of Object.values(h.client)) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  h.getMailcowClient.mockReset().mockReturnValue(h.client);
  h.mailcowMailHost.mockReset().mockReturnValue("mail.acme.test");
  h.buildDnsRecords.mockReset().mockReturnValue([]);
  h.checkDnsRecords.mockReset().mockResolvedValue([]);
  h.detectDnsProvider
    .mockReset()
    .mockResolvedValue({ provider: "UNKNOWN", nameservers: [] });

  h.client.listDomains.mockResolvedValue([ACME]);
  h.client.listMailboxes.mockResolvedValue([]);
  h.client.getDkim.mockResolvedValue(null);

  // Default: nobody has claimed anything, which is the single-org case.
  prismaMock.orgMailDomain.findMany.mockResolvedValue([] as never);
  prismaMock.orgMailDomain.findUnique.mockResolvedValue(null);
  prismaMock.mailDomainGrant.findMany.mockResolvedValue([] as never);
  prismaMock.mailDomainGrant.findUnique.mockResolvedValue(null);
});

describe("domain ownership", () => {
  const claimedByOther = [
    { domain: "acme.test", organizationId: "org_2" },
  ] as never;

  it("hides a domain another org has claimed from this org's owner", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue(claimedByOther);

    const status = await mailcowService.status(ownerActor);

    expect(status.domains).toEqual([]);
    expect(status.restricted).toBe(true);
  });

  it("shows an unclaimed domain to an owner, so it can be claimed", async () => {
    const status = await mailcowService.status(ownerActor);

    expect(status.domains).toEqual(["acme.test"]);
  });

  it("shows a domain this org has claimed", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      { domain: "acme.test", organizationId: "org_1" },
    ] as never);

    const status = await mailcowService.status(ownerActor);

    expect(status.domains).toEqual(["acme.test"]);
  });

  // A grant narrows within the org's own reach; it must never widen it.
  it("does not let a domain grant reach another org's domain", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue(claimedByOther);
    prismaMock.mailDomainGrant.findMany.mockResolvedValue([
      { domain: "acme.test" },
    ] as never);

    const status = await mailcowService.status(adminActor);

    expect(status.domains).toEqual([]);
  });

  it("refuses a mutating action on another org's domain even for an OWNER", async () => {
    prismaMock.orgMailDomain.findUnique.mockResolvedValue({
      organizationId: "org_2",
    } as never);

    await expect(
      mailcowService.dnsStatus(
        { organizationId: "org_1", domain: "acme.test" },
        ownerActor
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "domain_not_granted" });
  });
});

describe("mailcowService.listDomains", () => {
  it("labels a domain no org has claimed as UNCLAIMED", async () => {
    await expect(mailcowService.listDomains(ownerActor)).resolves.toEqual([
      expect.objectContaining({ domain: "acme.test", ownership: "UNCLAIMED" }),
    ]);
  });

  it("labels this org's own domain CLAIMED and reports its DKIM key", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      { domain: "acme.test", organizationId: "org_1" },
    ] as never);
    h.client.getDkim.mockResolvedValue({
      selector: "dkim",
      txtValue: "v=DKIM1;p=k",
      keySize: 2048,
    });

    await expect(mailcowService.listDomains(ownerActor)).resolves.toEqual([
      expect.objectContaining({ ownership: "CLAIMED", hasDkim: true }),
    ]);
  });

  it("omits a domain another org has claimed", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      { domain: "acme.test", organizationId: "org_2" },
    ] as never);

    await expect(mailcowService.listDomains(ownerActor)).resolves.toEqual([]);
  });

  // One unreadable DKIM key must not blank the whole page.
  it("keeps listing a domain whose DKIM read fails", async () => {
    h.client.getDkim.mockRejectedValue(new Error("boom"));

    await expect(mailcowService.listDomains(ownerActor)).resolves.toEqual([
      expect.objectContaining({ domain: "acme.test", hasDkim: false }),
    ]);
  });
});

describe("mailcowService.createDomain", () => {
  const input = {
    organizationId: "org_1",
    domain: "new.test",
    description: "New",
    generateDkim: true,
  };

  beforeEach(() => {
    prismaMock.orgMailDomain.create.mockResolvedValue({ id: "omd_1" } as never);
  });

  it("creates the domain, generates DKIM and records the claim", async () => {
    await mailcowService.createDomain(input);

    expect(h.client.createDomain).toHaveBeenCalledWith(
      "new.test",
      expect.objectContaining({ description: "New" })
    );
    expect(h.client.generateDkim).toHaveBeenCalledWith("new.test");
    expect(prismaMock.orgMailDomain.create).toHaveBeenCalledWith({
      data: { domain: "new.test", organizationId: "org_1" },
    });
  });

  it("refuses a domain that already exists on the server", async () => {
    h.client.listDomains.mockResolvedValue([
      { ...ACME, domain_name: "new.test" },
    ]);

    await expect(
      mailcowService.createDomain(input)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.client.createDomain).not.toHaveBeenCalled();
  });

  it("refuses a domain another org has claimed", async () => {
    prismaMock.orgMailDomain.findUnique.mockResolvedValue({
      organizationId: "org_2",
    } as never);

    await expect(
      mailcowService.createDomain(input)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.client.createDomain).not.toHaveBeenCalled();
  });

  // An unrecorded domain reads as unclaimed, and so becomes visible to every
  // org on the instance — the exact leak this model closes. Undo instead.
  it("deletes the domain again when the claim cannot be recorded", async () => {
    prismaMock.orgMailDomain.create.mockRejectedValue(new Error("db down"));

    await expect(
      mailcowService.createDomain(input)
    ).rejects.toThrow("db down");
    expect(h.client.deleteDomain).toHaveBeenCalledWith("new.test");
  });

  // DKIM is a nice-to-have at creation time; the domain still delivers.
  it("still creates the domain when DKIM generation fails", async () => {
    h.client.generateDkim.mockRejectedValue(new Error("no dkim"));

    await expect(
      mailcowService.createDomain(input)
    ).resolves.toBeDefined();
    expect(h.client.deleteDomain).not.toHaveBeenCalled();
    expect(prismaMock.orgMailDomain.create).toHaveBeenCalled();
  });
});

describe("mailcowService.deleteDomain", () => {
  const input = {
    organizationId: "org_1",
    domain: "acme.test",
    confirm: "acme.test",
  };

  beforeEach(() => {
    prismaMock.sMTPConnection.deleteMany.mockResolvedValue({
      count: 1,
    } as never);
    prismaMock.inboxAccount.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.mailDomainGrant.deleteMany.mockResolvedValue({
      count: 0,
    } as never);
    prismaMock.orgMailDomain.deleteMany.mockResolvedValue({
      count: 1,
    } as never);
  });

  // Mailcow would delete the domain and every message under it in one call.
  it("refuses while mailboxes still exist on the domain", async () => {
    h.client.listMailboxes.mockResolvedValue([
      {
        email: "ama@acme.test",
        name: "Ama",
        active: true,
        quotaBytes: 0,
        usedBytes: 0,
      },
    ]);

    await expect(
      mailcowService.deleteDomain(input, ownerActor)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.client.deleteDomain).not.toHaveBeenCalled();
  });

  it("refuses when the typed confirmation does not match", async () => {
    await expect(
      mailcowService.deleteDomain({ ...input, confirm: "acme.tes" }, ownerActor)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(h.client.deleteDomain).not.toHaveBeenCalled();
  });

  it("deletes the empty domain and cleans up QQueue's side", async () => {
    const result = await mailcowService.deleteDomain(input, ownerActor);

    expect(h.client.deleteDomain).toHaveBeenCalledWith("acme.test");
    expect(result).toEqual({
      domain: "acme.test",
      smtpConnectionsDeleted: 1,
      inboxAccountsDisabled: 1,
    });
    // Disabled, never deleted: InboundMessage cascades from InboxAccount.
    expect(prismaMock.inboxAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses to delete a domain another org has claimed", async () => {
    prismaMock.orgMailDomain.findUnique.mockResolvedValue({
      organizationId: "org_2",
    } as never);

    await expect(
      mailcowService.deleteDomain(input, ownerActor)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(h.client.deleteDomain).not.toHaveBeenCalled();
  });
});

describe("mailcowService.claimDomain", () => {
  it("claims an unclaimed server domain, normalising the name", async () => {
    prismaMock.orgMailDomain.create.mockResolvedValue({ id: "omd_1" } as never);
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      { domain: "acme.test", organizationId: "org_1" },
    ] as never);

    await mailcowService.claimDomain(
      { organizationId: "org_1", domain: "Acme.Test" },
      ownerActor
    );

    expect(prismaMock.orgMailDomain.create).toHaveBeenCalledWith({
      data: { domain: "acme.test", organizationId: "org_1" },
    });
  });

  it("refuses a domain another org already claimed", async () => {
    prismaMock.orgMailDomain.findUnique.mockResolvedValue({
      organizationId: "org_2",
    } as never);

    await expect(
      mailcowService.claimDomain(
        { organizationId: "org_1", domain: "acme.test" },
        ownerActor
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.orgMailDomain.create).not.toHaveBeenCalled();
  });

  it("refuses a domain that is not on the mail server at all", async () => {
    await expect(
      mailcowService.claimDomain(
        { organizationId: "org_1", domain: "ghost.test" },
        ownerActor
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("mailcowService.updateDomain", () => {
  it("edits the domain and reads the result back from the server", async () => {
    await mailcowService.updateDomain(
      { organizationId: "org_1", domain: "acme.test", description: "Renamed" },
      ownerActor
    );

    expect(h.client.updateDomain).toHaveBeenCalledWith(
      "acme.test",
      expect.objectContaining({ description: "Renamed" })
    );
  });

  // Mailcow does nothing for an unknown domain rather than erroring, so a typo
  // would otherwise report cheerful success.
  it("refuses a domain that is not on the server", async () => {
    await expect(
      mailcowService.updateDomain(
        { organizationId: "org_1", domain: "ghost.test" },
        ownerActor
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(h.client.updateDomain).not.toHaveBeenCalled();
  });
});

describe("mailcowService.generateDkim", () => {
  // Regenerating would have Mailcow sign with a key whose record is not
  // published, breaking every signature until DNS caught up.
  it("refuses when the domain already has a key", async () => {
    h.client.getDkim.mockResolvedValue({
      selector: "dkim",
      txtValue: "v=DKIM1;p=k",
      keySize: 2048,
    });

    await expect(
      mailcowService.generateDkim(
        { organizationId: "org_1", domain: "acme.test" },
        ownerActor
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.client.generateDkim).not.toHaveBeenCalled();
  });

  it("generates a key when there is none", async () => {
    await mailcowService.generateDkim(
      { organizationId: "org_1", domain: "acme.test" },
      ownerActor
    );

    expect(h.client.generateDkim).toHaveBeenCalledWith("acme.test");
  });
});

describe("mailcowService.dnsStatus", () => {
  it("reports ready only when every required record is live", async () => {
    h.checkDnsRecords.mockResolvedValue([
      { key: "mx", required: true, status: "OK" },
      { key: "spf", required: true, status: "OK" },
      { key: "autoconfig", required: false, status: "MISSING" },
    ]);

    const dns = await mailcowService.dnsStatus(
      { organizationId: "org_1", domain: "acme.test" },
      ownerActor
    );

    expect(dns.ready).toBe(true);
    expect(dns.mailHost).toBe("mail.acme.test");
  });

  // "Couldn't check" must not read as ready — that would tell an owner their
  // domain works when nothing has been verified at all.
  it("is not ready when a required record could not be checked", async () => {
    h.checkDnsRecords.mockResolvedValue([
      { key: "mx", required: true, status: "UNKNOWN" },
    ]);

    const dns = await mailcowService.dnsStatus(
      { organizationId: "org_1", domain: "acme.test" },
      ownerActor
    );

    expect(dns.ready).toBe(false);
  });
});
