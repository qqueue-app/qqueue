import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

/**
 * The domain-ownership model that scopes what an *organization* may touch.
 *
 * Kept apart from service.test.ts, which covers mailbox provisioning: these
 * tests pin who may reach a domain on a mail server that every org on the
 * instance shares.
 *
 * They are regression tests for a real leak. Domains were originally visible to
 * any org OWNER, and later to any org that had not had them claimed by someone
 * else — but `POST /organizations` is ungated, so "org OWNER" is a role any user
 * can award themselves, and an unclaimed domain was therefore reachable by
 * everyone on the install. An org now reaches a domain only when an instance
 * administrator assigned it; unassigned means nobody. Domain *management* moved
 * out of this module entirely — see instance-admin/service.test.ts.
 */

const h = vi.hoisted(() => ({
  client: {
    listDomains: vi.fn(),
    listMailboxes: vi.fn(),
    setMailboxPassword: vi.fn(),
    getDkim: vi.fn(),
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

/** The domain is assigned to org_1 — the ordinary state after assignment. */
const assignedToUs = [
  { domain: "acme.test", organizationId: "org_1" },
] as never;
const assignedToOther: never[] = [] as never;

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

  // Default: nothing is assigned to anyone. Under the old model this was the
  // permissive case; it is now the closed one.
  prismaMock.orgMailDomain.findMany.mockResolvedValue([] as never);
  prismaMock.mailDomainGrant.findMany.mockResolvedValue([] as never);
  prismaMock.mailDomainGrant.findUnique.mockResolvedValue(null);
});

describe("domain ownership", () => {
  it("hides an unassigned domain from an owner", async () => {
    const status = await mailcowService.status(ownerActor);

    expect(status.domains).toEqual([]);
  });

  it("shows a domain assigned to this org", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue(assignedToUs);

    const status = await mailcowService.status(ownerActor);

    expect(status.domains).toEqual(["acme.test"]);
  });

  it("hides a domain assigned to another org", async () => {
    // The scope query filters by organizationId, so another org's row simply
    // does not come back.
    prismaMock.orgMailDomain.findMany.mockResolvedValue(assignedToOther);

    const status = await mailcowService.status(ownerActor);

    expect(status.domains).toEqual([]);
  });

  // A grant narrows within the org's own reach; it must never widen it.
  it("does not let a domain grant reach a domain the org was not assigned", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([] as never);
    prismaMock.mailDomainGrant.findMany.mockResolvedValue([
      { domain: "acme.test" },
    ] as never);

    const status = await mailcowService.status(adminActor);

    expect(status.domains).toEqual([]);
  });

  it("narrows an assigned domain to admins who hold a grant for it", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue(assignedToUs);
    prismaMock.mailDomainGrant.findMany.mockResolvedValue([
      { domain: "acme.test" },
    ] as never);

    const status = await mailcowService.status(adminActor);

    expect(status.domains).toEqual(["acme.test"]);
    expect(status.restricted).toBeUndefined();
  });

  it("flags the restriction when a grant narrows what the org can see", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue(assignedToUs);
    prismaMock.mailDomainGrant.findMany.mockResolvedValue([] as never);

    const status = await mailcowService.status(adminActor);

    expect(status.domains).toEqual([]);
    expect(status.restricted).toBe(true);
  });

  // The heart of it: default deny on a mutating action. Before this, an
  // unassigned domain was fair game for any OWNER on the instance.
  it("refuses a mutating action on an unassigned domain even for an OWNER", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([] as never);

    await expect(
      mailcowService.resetPassword(
        { organizationId: "org_1", email: "hello@acme.test" },
        ownerActor
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "domain_not_granted" });
  });

  it("refuses a mutating action on another org's domain even for an OWNER", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      { organizationId: "org_2" },
    ] as never);

    await expect(
      mailcowService.resetPassword(
        { organizationId: "org_1", email: "hello@acme.test" },
        ownerActor
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "domain_not_granted" });
  });

  it("allows a mutating action on a domain assigned to this org", async () => {
    prismaMock.orgMailDomain.findMany.mockResolvedValue([
      { organizationId: "org_1" },
    ] as never);
    h.client.listMailboxes.mockResolvedValue([
      { email: "hello@acme.test", name: "Hello", active: true },
    ]);

    await expect(
      mailcowService.resetPassword(
        { organizationId: "org_1", email: "hello@acme.test" },
        ownerActor
      )
    ).resolves.toMatchObject({ email: "hello@acme.test" });
  });
});
