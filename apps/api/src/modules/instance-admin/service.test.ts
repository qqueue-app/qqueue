import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

/**
 * Install-scope administration: mail domains, their assignment to orgs, domain
 * grants, and the personal view filters.
 *
 * Most of this moved here from the mailcow module, where it sat behind
 * `requireOrgRole("OWNER")`. That was the wrong gate: `POST /organizations` is
 * ungated, so any user could create an org, become its OWNER, and manage the
 * mail server the whole install shares. The tests that matter most here are the
 * ones pinning assignment, because assignment is what access now depends on.
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

vi.mock("../mailcow/client.js", () => ({
  getMailcowClient: h.getMailcowClient,
  mailcowMailHost: h.mailcowMailHost,
}));

vi.mock("../mailcow/dns.js", () => ({
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

const { instanceAdminService } = await import("./service.js");

const ADMIN = "admin_1";

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

  prismaMock.orgMailDomain.findMany.mockResolvedValue([] as never);
  prismaMock.orgMailDomain.findUnique.mockResolvedValue(null);
  prismaMock.instanceAdminMute.findMany.mockResolvedValue([] as never);
  prismaMock.mailDomainGrant.findMany.mockResolvedValue([] as never);
  prismaMock.sMTPConnection.findMany.mockResolvedValue([] as never);
  prismaMock.$transaction.mockImplementation(
    async (arg: unknown) =>
      Array.isArray(arg) ? await Promise.all(arg) : await (arg as () => unknown)()
  );
});

describe("instanceAdminService.listDomains", () => {
  it("labels an unassigned domain and names no organization", async () => {
    await expect(instanceAdminService.listDomains(ADMIN)).resolves.toEqual([
      expect.objectContaining({
        domain: "acme.test",
        ownership: "UNCLAIMED",
        organizationId: null,
        organizationName: null,
      }),
    ]);
  });

  it("names the organization a domain is assigned to", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      {
        domain: "acme.test",
        organizationId: "org_1",
        organization: { name: "Acme" },
      },
    ] as never);

    await expect(instanceAdminService.listDomains(ADMIN)).resolves.toEqual([
      expect.objectContaining({
        ownership: "CLAIMED",
        organizationId: "org_1",
        organizationName: "Acme",
      }),
    ]);
  });

  // Unlike the org-scoped view this one hides nothing: an administrator has to
  // be able to see a domain in order to assign it.
  it("lists a domain assigned to some other organization", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      {
        domain: "acme.test",
        organizationId: "org_2",
        organization: { name: "Other" },
      },
    ] as never);

    const rows = await instanceAdminService.listDomains(ADMIN);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationName).toBe("Other");
  });

  it("flags a muted domain without dropping it from the list", async () => {
    prismaMock.instanceAdminMute.findMany.mockResolvedValue([
      { scope: "DOMAIN", target: "acme.test" },
    ] as never);

    await expect(instanceAdminService.listDomains(ADMIN)).resolves.toEqual([
      expect.objectContaining({ domain: "acme.test", muted: true }),
    ]);
  });

  it("keeps listing a domain whose DKIM read fails", async () => {
    h.client.getDkim.mockRejectedValue(new Error("boom"));

    await expect(instanceAdminService.listDomains(ADMIN)).resolves.toEqual([
      expect.objectContaining({ domain: "acme.test", hasDkim: false }),
    ]);
  });
});

describe("instanceAdminService.assignDomain", () => {
  it("assigns an unassigned domain to an organization", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org_1",
      name: "Acme",
    } as never);

    await instanceAdminService.assignDomain(
      "Acme.Test",
      { organizationId: "org_1" },
      ADMIN
    );

    expect(prismaMock.orgMailDomain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: "acme.test" },
        create: { domain: "acme.test", organizationId: "org_1" },
        update: { organizationId: "org_1" },
      })
    );
  });

  // A grant is delegation *within* an assignment, so it cannot outlive one.
  it("drops the losing org's grants when a domain is reassigned", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org_2",
      name: "Other",
    } as never);
    prismaMock.orgMailDomain.findUnique.mockResolvedValue({
      organizationId: "org_1",
    } as never);

    await instanceAdminService.assignDomain(
      "acme.test",
      { organizationId: "org_2" },
      ADMIN
    );

    expect(prismaMock.mailDomainGrant.deleteMany).toHaveBeenCalledWith({
      where: { domain: "acme.test", organizationId: "org_1" },
    });
  });

  it("unassigns a domain and clears its grants", async () => {
    await expect(
      instanceAdminService.assignDomain(
        "acme.test",
        { organizationId: null },
        ADMIN
      )
    ).resolves.toBeNull();

    expect(prismaMock.mailDomainGrant.deleteMany).toHaveBeenCalledWith({
      where: { domain: "acme.test" },
    });
    expect(prismaMock.orgMailDomain.deleteMany).toHaveBeenCalledWith({
      where: { domain: "acme.test" },
    });
  });

  it("refuses to assign a domain the mail server does not have", async () => {
    h.client.listDomains.mockResolvedValue([]);

    await expect(
      instanceAdminService.assignDomain(
        "ghost.test",
        { organizationId: "org_1" },
        ADMIN
      )
    ).rejects.toMatchObject({ statusCode: 404, code: "not_found" });
  });

  it("refuses to assign to an organization that does not exist", async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);

    await expect(
      instanceAdminService.assignDomain(
        "acme.test",
        { organizationId: "nope" },
        ADMIN
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("instanceAdminService.createDomain", () => {
  const input = {
    domain: "new.test",
    description: "New",
    generateDkim: true,
    active: true,
  };

  it("creates the domain and records the assignment when one is given", async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      name: "Acme",
    } as never);

    const result = await instanceAdminService.createDomain({
      ...input,
      organizationId: "org_1",
    });

    expect(h.client.createDomain).toHaveBeenCalled();
    expect(h.client.generateDkim).toHaveBeenCalledWith("new.test");
    expect(prismaMock.orgMailDomain.create).toHaveBeenCalledWith({
      data: { domain: "new.test", organizationId: "org_1" },
    });
    expect(result.domain.organizationName).toBe("Acme");
  });

  // Safe now in a way it was not before: an unassigned domain reaches nobody,
  // so standing one up ahead of deciding who gets it exposes nothing.
  it("creates an unassigned domain when no organization is given", async () => {
    const result = await instanceAdminService.createDomain(input);

    expect(prismaMock.orgMailDomain.create).not.toHaveBeenCalled();
    expect(result.domain.ownership).toBe("UNCLAIMED");
    expect(result.domain.organizationId).toBeNull();
  });

  it("refuses a domain the mail server already has", async () => {
    h.client.listDomains.mockResolvedValue([
      { ...ACME, domain_name: "new.test" },
    ]);

    await expect(instanceAdminService.createDomain(input)).rejects.toMatchObject(
      { statusCode: 409, code: "conflict" }
    );
  });

  it("still creates the domain when DKIM generation fails", async () => {
    h.client.generateDkim.mockRejectedValue(new Error("no key"));

    await expect(
      instanceAdminService.createDomain(input)
    ).resolves.toMatchObject({ domain: { domain: "new.test" } });
  });
});

describe("instanceAdminService.deleteDomain", () => {
  it("refuses while mailboxes still exist on it", async () => {
    h.client.listMailboxes.mockResolvedValue([{ email: "a@acme.test" }]);

    await expect(
      instanceAdminService.deleteDomain({
        domain: "acme.test",
        confirm: "acme.test",
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "conflict" });
    expect(h.client.deleteDomain).not.toHaveBeenCalled();
  });

  it("refuses on a mistyped confirmation", async () => {
    await expect(
      instanceAdminService.deleteDomain({
        domain: "acme.test",
        confirm: "acme.tes",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(h.client.deleteDomain).not.toHaveBeenCalled();
  });

  // The domain leaves the server for everyone, so cleanup is not org-scoped —
  // that is the one real behavioural difference from the old org version.
  it("cleans up every organization's bookkeeping, not just one", async () => {
    prismaMock.sMTPConnection.deleteMany.mockResolvedValue({
      count: 2,
    } as never);
    prismaMock.inboxAccount.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await instanceAdminService.deleteDomain({
      domain: "acme.test",
      confirm: "acme.test",
    });

    expect(prismaMock.sMTPConnection.deleteMany).toHaveBeenCalledWith({
      where: { fromEmail: { endsWith: "@acme.test", mode: "insensitive" } },
    });
    expect(result).toMatchObject({
      smtpConnectionsDeleted: 2,
      inboxAccountsDisabled: 1,
    });
  });
});

describe("instanceAdminService.addDomainGrant", () => {
  beforeEach(() => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "ADMIN",
    } as never);
    prismaMock.orgMailDomain.findUnique.mockResolvedValue({
      organizationId: "org_1",
    } as never);
  });

  it("grants a member of the org a domain the org holds", async () => {
    await instanceAdminService.addDomainGrant({
      organizationId: "org_1",
      userId: "u1",
      domain: "ACME.test",
    });

    expect(prismaMock.mailDomainGrant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { organizationId: "org_1", userId: "u1", domain: "acme.test" },
      })
    );
  });

  // Without this an administrator could grant an org a domain it does not have,
  // which would read as working and silently do nothing.
  it("refuses a domain not assigned to that organization", async () => {
    prismaMock.orgMailDomain.findUnique.mockResolvedValue({
      organizationId: "org_2",
    } as never);

    await expect(
      instanceAdminService.addDomainGrant({
        organizationId: "org_1",
        userId: "u1",
        domain: "acme.test",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a domain assigned to nobody", async () => {
    prismaMock.orgMailDomain.findUnique.mockResolvedValue(null);

    await expect(
      instanceAdminService.addDomainGrant({
        organizationId: "org_1",
        userId: "u1",
        domain: "acme.test",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a grantee who is not a member of the organization", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);

    await expect(
      instanceAdminService.addDomainGrant({
        organizationId: "org_1",
        userId: "outsider",
        domain: "acme.test",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("refuses a domain the mail server does not serve", async () => {
    h.client.listDomains.mockResolvedValue([{ ...ACME, active: false }]);

    await expect(
      instanceAdminService.addDomainGrant({
        organizationId: "org_1",
        userId: "u1",
        domain: "acme.test",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("instance admin mutes", () => {
  it("lowercases a domain target so it matches the domain list", async () => {
    prismaMock.instanceAdminMute.upsert.mockResolvedValue({
      id: "m1",
      scope: "DOMAIN",
      target: "acme.test",
      createdAt: new Date("2026-08-09T00:00:00Z"),
    } as never);

    await instanceAdminService.addMute(ADMIN, {
      scope: "DOMAIN",
      target: "ACME.Test",
    });

    expect(prismaMock.instanceAdminMute.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: ADMIN, scope: "DOMAIN", target: "acme.test" },
      })
    );
  });

  it("scopes removal to the calling administrator", async () => {
    await instanceAdminService.removeMute("m1", ADMIN);

    expect(prismaMock.instanceAdminMute.deleteMany).toHaveBeenCalledWith({
      where: { id: "m1", userId: ADMIN },
    });
  });
});
