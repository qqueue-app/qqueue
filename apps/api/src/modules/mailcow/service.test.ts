import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";

// The Mailcow client is stubbed: these tests pin the provisioning
// orchestration (ordering, transaction contents, cleanup), not HTTP shapes —
// client.test.ts covers those.
const h = vi.hoisted(() => ({
  client: {
    listDomains: vi.fn(),
    createMailbox: vi.fn(),
    createAppPassword: vi.fn(),
    deleteMailbox: vi.fn(),
    setMailboxPassword: vi.fn(),
    setMailboxActive: vi.fn(),
    listMailboxes: vi.fn(),
    createDomain: vi.fn(),
    updateDomain: vi.fn(),
    deleteDomain: vi.fn(),
    getDkim: vi.fn(),
    generateDkim: vi.fn(),
    verify: vi.fn(),
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

// DNS is stubbed wholesale: these tests pin the service's orchestration and
// authorisation, and a real resolver would make them slow and network-bound.
// dns.test.ts covers the record building and matching.
vi.mock("./dns.js", () => ({
  buildDnsRecords: h.buildDnsRecords,
  checkDnsRecords: h.checkDnsRecords,
  detectDnsProvider: h.detectDnsProvider,
}));

// Keep normalizeDefault/smtpConnectionSelect real; stub only the SMTP probe so
// no test ever opens a socket.
vi.mock("../smtp-connections/service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../smtp-connections/service.js")
  >("../smtp-connections/service.js");
  return { ...actual, verifyConnection: h.verifyConnection };
});

const { mailcowService } = await import("./service.js");
const { decryptSecret } = await import("../../lib/crypto.js");

const ownerActor = {
  organizationId: "org_1",
  userId: "owner_1",
  role: "OWNER",
};
const adminActor = {
  organizationId: "org_1",
  userId: "admin_1",
  role: "ADMIN",
};

const provisionInput = {
  organizationId: "org_1",
  localPart: "Ama",
  domain: "Acme.Test",
  name: "Ama Mensah",
  assignToUserId: "user_ama",
};

beforeEach(() => {
  for (const fn of Object.values(h.client)) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  h.verifyConnection.mockReset().mockResolvedValue(undefined);
  h.buildDnsRecords.mockReset().mockReturnValue([]);
  h.checkDnsRecords.mockReset().mockResolvedValue([]);
  h.detectDnsProvider
    .mockReset()
    .mockResolvedValue({ provider: "UNKNOWN", nameservers: [] });
  h.client.getDkim.mockResolvedValue(null);
  h.getMailcowClient.mockReturnValue(h.client);
  h.mailcowMailHost.mockReturnValue("mail.acme.test");
  h.client.listDomains.mockResolvedValue([
    { domain_name: "acme.test", active: true },
    { domain_name: "inactive.test", active: false },
  ]);
  h.client.listMailboxes.mockResolvedValue([]);
  // Both server domains are assigned to org_1 — the ordinary state once an
  // instance administrator has handed them over, and the precondition these
  // provisioning tests assume. An *unassigned* domain now reaches no org at
  // all, so leaving these empty would default-deny every case below; that
  // boundary is pinned in service.domains.test.ts instead.
  prismaMock.orgMailDomain.findMany.mockResolvedValue([
    { domain: "acme.test" },
    { domain: "inactive.test" },
  ] as never);
  prismaMock.orgMailDomain.findUnique.mockResolvedValue({
    organizationId: "org_1",
  } as never);
  prismaMock.sMTPConnection.findMany.mockResolvedValue([] as never);
  // Org membership for the assignee; no pre-existing inbox; no default yet.
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "MEMBER",
  } as never);
  prismaMock.inboxAccount.findUnique.mockResolvedValue(null);
  prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
  prismaMock.sMTPConnection.create.mockResolvedValue({
    id: "s_new",
    organizationId: "org_1",
    name: "Ama Mensah",
    host: "mail.acme.test",
    port: 465,
    secure: true,
    fromEmail: "ama@acme.test",
    fromName: "Ama Mensah",
    isDefault: true,
    createdAt: new Date("2026-08-06T00:00:00Z"),
    updatedAt: new Date("2026-08-06T00:00:00Z"),
  } as never);
  prismaMock.inboxAccount.create.mockResolvedValue({ id: "inbox_1" } as never);
});

describe("mailcowService.status", () => {
  it("reports unconfigured when the instance has no Mailcow env", async () => {
    h.getMailcowClient.mockReturnValue(null);
    h.mailcowMailHost.mockReturnValue(null);
    await expect(mailcowService.status(ownerActor)).resolves.toEqual({
      configured: false,
      reachable: false,
      domains: [],
      mailHost: null,
    });
  });

  it("lists only active domains when reachable", async () => {
    await expect(mailcowService.status(ownerActor)).resolves.toMatchObject({
      configured: true,
      reachable: true,
      domains: ["acme.test"],
      mailHost: "mail.acme.test",
    });
  });

  it("reports unreachable with the error message", async () => {
    h.client.listDomains.mockRejectedValue(new Error("connect timeout"));
    await expect(mailcowService.status(ownerActor)).resolves.toMatchObject({
      configured: true,
      reachable: false,
      error: "connect timeout",
    });
  });
});

describe("mailcowService.provision", () => {
  it("provisions mailbox + app password + connection + inbox + grant in one flow", async () => {
    const result = await mailcowService.provision(provisionInput, {
      userId: "owner_1",
      role: "OWNER",
    });

    // Address is normalized to lowercase everywhere.
    expect(h.client.createMailbox).toHaveBeenCalledWith({
      localPart: "ama",
      domain: "acme.test",
      name: "Ama Mensah",
      password: expect.any(String),
    });
    expect(h.client.createAppPassword).toHaveBeenCalledWith({
      email: "ama@acme.test",
      name: "QQueue",
      password: expect.any(String),
    });

    // QQueue stores the app password, never the mailbox password.
    const appPassword = h.client.createAppPassword.mock.calls[0][0].password;
    const connectionData =
      prismaMock.sMTPConnection.create.mock.calls[0][0].data;
    expect(connectionData).toMatchObject({
      organizationId: "org_1",
      host: "mail.acme.test",
      port: 465,
      secure: true,
      fromEmail: "ama@acme.test",
      isDefault: true,
    });
    expect(decryptSecret(connectionData.passwordEncrypted)).toBe(appPassword);
    expect(decryptSecret(connectionData.usernameEncrypted)).toBe(
      "ama@acme.test"
    );

    // The sync-enabled InboxAccount is mandatory: it gives DSN parsing bounce
    // visibility for this identity.
    const inboxData = prismaMock.inboxAccount.create.mock.calls[0][0].data;
    expect(inboxData).toMatchObject({
      email: "ama@acme.test",
      host: "mail.acme.test",
      port: 993,
      secure: true,
      status: "ACTIVE",
    });
    expect(decryptSecret(inboxData.passwordEncrypted)).toBe(appPassword);

    expect(prismaMock.smtpConnectionGrant.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org_1",
        smtpConnectionId: "s_new",
        userId: "user_ama",
      },
    });

    expect(result.email).toBe("ama@acme.test");
    expect(result.mailboxPassword).toEqual(expect.any(String));
    expect(result.mailboxPassword).not.toBe(appPassword);
    expect(result.smtpConnection.id).toBe("s_new");
    expect(result.inboxAccountId).toBe("inbox_1");
    expect(result.verified).toBe(true);
  });

  it("reports verified: false without rolling back when the probe never passes", async () => {
    vi.useFakeTimers();
    try {
      // Mailbox not active yet: every probe attempt fails.
      h.verifyConnection.mockRejectedValue(new Error("535 auth failed"));

      const promise = mailcowService.provision(provisionInput, {
        userId: "owner_1",
        role: "OWNER",
      });
      await vi.runAllTimersAsync(); // skip the probe's backoff sleeps
      const result = await promise;

      expect(result.verified).toBe(false);
      // Everything was still created and nothing was cleaned up — false is a
      // warning, not a failure.
      expect(prismaMock.sMTPConnection.create).toHaveBeenCalled();
      expect(prismaMock.inboxAccount.create).toHaveBeenCalled();
      expect(h.client.deleteMailbox).not.toHaveBeenCalled();
      // It retried before giving up.
      expect(h.verifyConnection).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers to verified: true when a later probe attempt succeeds", async () => {
    vi.useFakeTimers();
    try {
      h.verifyConnection
        .mockRejectedValueOnce(new Error("535 auth failed"))
        .mockResolvedValueOnce(undefined);

      const promise = mailcowService.provision(provisionInput, {
        userId: "owner_1",
        role: "OWNER",
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.verified).toBe(true);
      expect(h.verifyConnection).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the grant when no assignee is named", async () => {
    await mailcowService.provision(
      {
        ...provisionInput,
        assignToUserId: undefined,
      },
      { userId: "owner_1", role: "OWNER" }
    );
    expect(prismaMock.smtpConnectionGrant.create).not.toHaveBeenCalled();
  });

  it("404s when the instance has no Mailcow configured", async () => {
    h.getMailcowClient.mockReturnValue(null);
    await expect(
      mailcowService.provision(provisionInput, {
        userId: "owner_1",
        role: "OWNER",
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "mailcow_not_configured",
    });
  });

  it("rejects a domain Mailcow does not serve, before any mutation", async () => {
    await expect(
      mailcowService.provision(
        { ...provisionInput, domain: "other.test" },
        { userId: "owner_1", role: "OWNER" }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(h.client.createMailbox).not.toHaveBeenCalled();
  });

  it("rejects an inactive domain", async () => {
    await expect(
      mailcowService.provision(
        { ...provisionInput, domain: "inactive.test" },
        { userId: "owner_1", role: "OWNER" }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(h.client.createMailbox).not.toHaveBeenCalled();
  });

  it("rejects an assignee who is not an org member, before any mutation", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue(null);
    await expect(
      mailcowService.provision(provisionInput, {
        userId: "owner_1",
        role: "OWNER",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(h.client.createMailbox).not.toHaveBeenCalled();
  });

  it("409s when the address is already connected to the org", async () => {
    prismaMock.inboxAccount.findUnique.mockResolvedValue({
      id: "existing",
    } as never);
    await expect(
      mailcowService.provision(provisionInput, {
        userId: "owner_1",
        role: "OWNER",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.client.createMailbox).not.toHaveBeenCalled();
  });

  it("deletes the Mailcow mailbox when the QQueue side fails (no orphans)", async () => {
    prismaMock.sMTPConnection.create.mockRejectedValue(new Error("db down"));

    await expect(
      mailcowService.provision(provisionInput, {
        userId: "owner_1",
        role: "OWNER",
      })
    ).rejects.toThrow("db down");
    expect(h.client.deleteMailbox).toHaveBeenCalledWith("ama@acme.test");
  });

  it("surfaces the original error even when cleanup also fails", async () => {
    prismaMock.sMTPConnection.create.mockRejectedValue(new Error("db down"));
    h.client.deleteMailbox.mockRejectedValue(new Error("mailcow gone"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      mailcowService.provision(provisionInput, {
        userId: "owner_1",
        role: "OWNER",
      })
    ).rejects.toThrow("db down");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// Domain access: OWNERs see and use every active domain; ADMINs only granted
// ones (default deny).
describe("domain access", () => {
  it("filters status domains for an ADMIN and flags the restriction", async () => {
    prismaMock.mailDomainGrant.findMany.mockResolvedValue([
      { domain: "acme.test" },
    ] as never);
    h.client.listDomains.mockResolvedValue([
      { domain_name: "acme.test", active: true },
      { domain_name: "other.test", active: true },
    ]);

    await expect(mailcowService.status(adminActor)).resolves.toMatchObject({
      domains: ["acme.test"],
      restricted: true,
    });
  });

  it("shows an ADMIN with no grants an empty, restricted list", async () => {
    prismaMock.mailDomainGrant.findMany.mockResolvedValue([] as never);
    await expect(mailcowService.status(adminActor)).resolves.toMatchObject({
      domains: [],
      restricted: true,
    });
  });

  it("never marks an OWNER restricted", async () => {
    const status = await mailcowService.status(ownerActor);
    expect(status.restricted).toBeUndefined();
    expect(prismaMock.mailDomainGrant.findMany).not.toHaveBeenCalled();
  });

  it("blocks an ADMIN provisioning on an ungranted domain", async () => {
    prismaMock.mailDomainGrant.findUnique.mockResolvedValue(null);

    await expect(
      mailcowService.provision(provisionInput, {
        userId: "admin_1",
        role: "ADMIN",
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "domain_not_granted" });
    expect(h.client.createMailbox).not.toHaveBeenCalled();
  });

  it("lets an ADMIN provision on a granted domain", async () => {
    prismaMock.mailDomainGrant.findUnique.mockResolvedValue({
      id: "dg_1",
    } as never);

    const result = await mailcowService.provision(provisionInput, {
      userId: "admin_1",
      role: "ADMIN",
    });

    expect(result.email).toBe("ama@acme.test");
    expect(prismaMock.mailDomainGrant.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_userId_domain: {
          organizationId: "org_1",
          userId: "admin_1",
          domain: "acme.test",
        },
      },
      select: { id: true },
    });
  });
});

// The list is the union of two systems, so the interesting cases are all about
// which side a row came from and what that permits.
describe("mailcowService.listMailboxes", () => {
  const serverMailbox = {
    email: "ama@acme.test",
    name: "Ama Mensah",
    active: true,
    quotaBytes: 0,
    usedBytes: 2048,
  };

  const connectionRow = {
    id: "s_1",
    name: "Ama",
    host: "mail.acme.test",
    port: 465,
    fromEmail: "ama@acme.test",
    fromName: "Ama Mensah",
    isDefault: true,
  };

  it("marks a mailbox QQueue already sends from as MANAGED", async () => {
    h.client.listMailboxes.mockResolvedValue([serverMailbox]);
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      connectionRow,
    ] as never);

    await expect(mailcowService.listMailboxes(ownerActor)).resolves.toEqual([
      expect.objectContaining({
        email: "ama@acme.test",
        origin: "MANAGED",
        smtpConnectionId: "s_1",
        host: "mail.acme.test",
        port: 465,
        isDefault: true,
        active: true,
        usedBytes: 2048,
      }),
    ]);
  });

  // The whole reason this endpoint exists: a mailbox made in the Mailcow UI
  // receives real mail, so the list has to admit it exists.
  it("surfaces a server mailbox QQueue has no credentials for", async () => {
    h.client.listMailboxes.mockResolvedValue([serverMailbox]);

    await expect(mailcowService.listMailboxes(ownerActor)).resolves.toEqual([
      expect.objectContaining({
        email: "ama@acme.test",
        origin: "SERVER_ONLY",
        smtpConnectionId: null,
        host: null,
      }),
    ]);
  });

  it("keeps a hand-added sending account with no mailbox behind it", async () => {
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      { ...connectionRow, host: "email-smtp.us-east-1.amazonaws.com" },
    ] as never);

    await expect(mailcowService.listMailboxes(ownerActor)).resolves.toEqual([
      expect.objectContaining({
        email: "ama@acme.test",
        origin: "EXTERNAL",
        active: null,
        quotaBytes: null,
        smtpConnectionId: "s_1",
      }),
    ]);
  });

  it("hides server mailboxes on domains an ADMIN was not granted", async () => {
    prismaMock.mailDomainGrant.findMany.mockResolvedValue([] as never);
    h.client.listMailboxes.mockResolvedValue([serverMailbox]);

    await expect(mailcowService.listMailboxes(adminActor)).resolves.toEqual([]);
  });

  // Losing the mail server must not blank the page: the sending accounts are
  // still true, and status() is what reports the outage.
  it("falls back to QQueue's own accounts when the mail server is down", async () => {
    h.client.listDomains.mockRejectedValue(new Error("ECONNREFUSED"));
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      connectionRow,
    ] as never);

    await expect(mailcowService.listMailboxes(ownerActor)).resolves.toEqual([
      expect.objectContaining({ email: "ama@acme.test", origin: "EXTERNAL" }),
    ]);
  });

  it("still lists sending accounts when Mailcow is not configured at all", async () => {
    h.getMailcowClient.mockReturnValue(null);
    prismaMock.sMTPConnection.findMany.mockResolvedValue([
      connectionRow,
    ] as never);

    const rows = await mailcowService.listMailboxes(ownerActor);
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe("EXTERNAL");
  });
});

describe("per-mailbox actions", () => {
  const serverMailbox = {
    email: "ama@acme.test",
    name: "Ama Mensah",
    active: true,
    quotaBytes: 0,
    usedBytes: 0,
  };
  const target = { organizationId: "org_1", email: "Ama@Acme.Test" };
  const owner = { userId: "owner_1", role: "OWNER" };
  const admin = { userId: "admin_1", role: "ADMIN" };

  beforeEach(() => {
    h.client.listMailboxes.mockResolvedValue([serverMailbox]);
  });

  it("rotates the password without touching the sending credentials", async () => {
    const result = await mailcowService.resetPassword(target, owner);

    expect(result.email).toBe("ama@acme.test");
    expect(result.mailboxPassword).toEqual(expect.any(String));
    expect(h.client.setMailboxPassword).toHaveBeenCalledWith(
      "ama@acme.test",
      result.mailboxPassword
    );
    // The app password QQueue sends with is a separate secret entirely.
    expect(prismaMock.sMTPConnection.update).not.toHaveBeenCalled();
    expect(h.client.createAppPassword).not.toHaveBeenCalled();
  });

  // Without the existence probe an admin could aim an action at any address
  // they can spell, on a domain they happen to hold a grant for.
  it("404s on an address the mail server does not have", async () => {
    h.client.listMailboxes.mockResolvedValue([]);

    await expect(
      mailcowService.resetPassword(target, owner)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(h.client.setMailboxPassword).not.toHaveBeenCalled();
  });

  it("blocks an ADMIN acting on an ungranted domain", async () => {
    prismaMock.mailDomainGrant.findUnique.mockResolvedValue(null);

    await expect(
      mailcowService.resetPassword(target, admin)
    ).rejects.toMatchObject({ statusCode: 403, code: "domain_not_granted" });
    expect(h.client.setMailboxPassword).not.toHaveBeenCalled();
    // Refused before the mailbox was even looked up.
    expect(h.client.listMailboxes).not.toHaveBeenCalled();
  });

  it("pauses and resumes delivery", async () => {
    await expect(
      mailcowService.setActive({ ...target, active: false }, owner)
    ).resolves.toEqual({ email: "ama@acme.test", active: false });
    expect(h.client.setMailboxActive).toHaveBeenCalledWith(
      "ama@acme.test",
      false
    );
  });

  it("adopts an existing mailbox into a connection + inbox, without creating one", async () => {
    prismaMock.smtpConnectionGrant.create.mockResolvedValue({} as never);

    const result = await mailcowService.adopt(
      { ...target, assignToUserId: "user_ama" },
      owner
    );

    expect(h.client.createMailbox).not.toHaveBeenCalled();
    expect(h.client.createAppPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ama@acme.test", name: "QQueue" })
    );
    expect(result.inboxAccountId).toBe("inbox_1");
    expect(result.email).toBe("ama@acme.test");

    // The stored credential is the app password, not the human's own.
    const created = prismaMock.sMTPConnection.create.mock.calls[0][0];
    expect(decryptSecret(created.data.usernameEncrypted)).toBe("ama@acme.test");
    expect(created.data.fromName).toBe("Ama Mensah");
  });

  it("409s rather than adopting an address already connected", async () => {
    prismaMock.inboxAccount.findUnique.mockResolvedValue({
      id: "inbox_existing",
    } as never);

    await expect(mailcowService.adopt(target, owner)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(h.client.createAppPassword).not.toHaveBeenCalled();
  });

  // Adoption must never delete a mailbox it did not create, even when QQueue's
  // own bookkeeping fails — unlike provisioning, which owns its rollback.
  it("leaves the mailbox alone when adopting fails halfway", async () => {
    h.client.createAppPassword.mockRejectedValue(new Error("nope"));

    await expect(mailcowService.adopt(target, owner)).rejects.toThrow("nope");
    expect(h.client.deleteMailbox).not.toHaveBeenCalled();
  });

  it("deletes the mailbox, drops the connection, and only disables the inbox", async () => {
    prismaMock.sMTPConnection.deleteMany.mockResolvedValue({
      count: 1,
    } as never);
    prismaMock.inboxAccount.updateMany.mockResolvedValue({ count: 1 } as never);

    await expect(mailcowService.remove(target, owner)).resolves.toEqual({
      email: "ama@acme.test",
      smtpConnectionDeleted: true,
      inboxAccountDisabled: true,
    });

    expect(h.client.deleteMailbox).toHaveBeenCalledWith("ama@acme.test");
    expect(prismaMock.sMTPConnection.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", fromEmail: "ama@acme.test" },
    });
    // Deleting the inbox account would cascade away every synced message.
    expect(prismaMock.inboxAccount.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.inboxAccount.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", email: "ama@acme.test" },
      data: { status: "DISABLED" },
    });
  });

  it("keeps QQueue's records when the mail server refuses the delete", async () => {
    h.client.deleteMailbox.mockRejectedValue(new Error("mailcow said no"));

    await expect(mailcowService.remove(target, owner)).rejects.toThrow(
      "mailcow said no"
    );
    expect(prismaMock.sMTPConnection.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.inboxAccount.updateMany).not.toHaveBeenCalled();
  });
});
