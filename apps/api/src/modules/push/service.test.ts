import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  pushSubscription: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  organizationMember: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  inboxAccount: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  inboxNotifyRule: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  // The domain path runs its writes in one transaction; the callback form gets
  // the same mock client, so assertions read off the calls above unchanged.
  $transaction: vi.fn(),
}));
vi.mock("../../lib/prisma.js", () => ({ prisma }));

const access = vi.hoisted(() => ({ resolveMailboxAccess: vi.fn() }));
vi.mock("../../lib/mailbox-access.js", () => access);

const env = vi.hoisted(() => ({
  current: {
    VAPID_PUBLIC_KEY: "public-key" as string | undefined,
    VAPID_PRIVATE_KEY: "private-key" as string | undefined,
  },
}));
vi.mock("../../config/env.js", () => ({
  get env() {
    return env.current;
  },
}));

import { pushService } from "./service.js";

describe("pushService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.current = {
      VAPID_PUBLIC_KEY: "public-key",
      VAPID_PRIVATE_KEY: "private-key",
    };
    prisma.$transaction.mockImplementation(
      (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma)
    );
    access.resolveMailboxAccess.mockResolvedValue({
      userId: "user_1",
      organizationId: "org_1",
      unrestricted: false,
      inboxAccountIds: ["inbox_1", "inbox_2"],
      smtpConnectionIds: [],
    });
  });

  describe("publicKey", () => {
    it("returns the key when both halves are configured", () => {
      expect(pushService.publicKey()).toBe("public-key");
    });

    it("reports nothing when the private half is missing", () => {
      // A half-configured pair is worse than none: the browser would subscribe
      // against a key the worker cannot sign with, and notifications would
      // fail silently forever.
      env.current = {
        VAPID_PUBLIC_KEY: "public-key",
        VAPID_PRIVATE_KEY: undefined,
      };
      expect(pushService.publicKey()).toBeNull();
    });

    it("reports nothing when push is not configured at all", () => {
      env.current = {
        VAPID_PUBLIC_KEY: undefined,
        VAPID_PRIVATE_KEY: undefined,
      };
      expect(pushService.publicKey()).toBeNull();
    });
  });

  describe("subscribe", () => {
    it("upserts on the endpoint so a re-registering device does not duplicate", async () => {
      prisma.pushSubscription.upsert.mockResolvedValue({
        id: "sub_1",
        endpoint: "https://push.example/abc",
        createdAt: new Date(),
      });

      await pushService.subscribe("user_1", {
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
        userAgent: "Chrome on macOS",
      });

      const call = prisma.pushSubscription.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ endpoint: "https://push.example/abc" });
      expect(call.create).toMatchObject({
        userId: "user_1",
        p256dh: "p",
        auth: "a",
        userAgent: "Chrome on macOS",
      });
      // A device is not bound to an org: which org's mail reaches it is
      // OrganizationMember.notifyLevel, not a column here.
      expect(call.create).not.toHaveProperty("organizationId");
    });

    it("reassigns ownership on update, since browsers recycle endpoints", async () => {
      prisma.pushSubscription.upsert.mockResolvedValue({
        id: "sub_1",
        endpoint: "https://push.example/abc",
        createdAt: new Date(),
      });

      await pushService.subscribe("user_2", {
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
      });

      // Without this, a shared device would keep alerting whoever registered
      // the endpoint first, after somebody else signed in on it.
      expect(
        prisma.pushSubscription.upsert.mock.calls[0][0].update
      ).toMatchObject({ userId: "user_2" });
    });
  });

  describe("rotate", () => {
    it("moves the registration to the new endpoint, keeping its owner", async () => {
      prisma.pushSubscription.findUnique.mockResolvedValue({
        id: "sub_1",
        userId: "user_1",
        userAgent: "Chrome on macOS",
      });
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pushSubscription.update.mockResolvedValue({
        id: "sub_1",
        endpoint: "https://push.example/new",
        createdAt: new Date(),
      });

      await pushService.rotate({
        oldEndpoint: "https://push.example/old",
        endpoint: "https://push.example/new",
        keys: { p256dh: "p2", auth: "a2" },
      });

      const call = prisma.pushSubscription.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "sub_1" });
      expect(call.data).toMatchObject({
        endpoint: "https://push.example/new",
        p256dh: "p2",
        auth: "a2",
      });
      // Ownership is carried over, never read from the request: a replayed
      // rotation must not be able to move someone else's device to an account.
      expect(call.data).not.toHaveProperty("userId");
    });

    it("keeps the stored label when the worker sends none", async () => {
      prisma.pushSubscription.findUnique.mockResolvedValue({
        id: "sub_1",
        userId: "user_1",
        userAgent: "Chrome on macOS",
      });
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pushSubscription.update.mockResolvedValue({
        id: "sub_1",
        endpoint: "https://push.example/new",
        createdAt: new Date(),
      });

      await pushService.rotate({
        oldEndpoint: "https://push.example/old",
        endpoint: "https://push.example/new",
        keys: { p256dh: "p2", auth: "a2" },
      });

      expect(
        prisma.pushSubscription.update.mock.calls[0][0].data.userAgent
      ).toBe("Chrome on macOS");
    });

    it("clears a stale row already holding the new endpoint", async () => {
      prisma.pushSubscription.findUnique.mockResolvedValue({
        id: "sub_1",
        userId: "user_1",
        userAgent: null,
      });
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
      prisma.pushSubscription.update.mockResolvedValue({
        id: "sub_1",
        endpoint: "https://push.example/new",
        createdAt: new Date(),
      });

      await pushService.rotate({
        oldEndpoint: "https://push.example/old",
        endpoint: "https://push.example/new",
        keys: { p256dh: "p2", auth: "a2" },
      });

      // Otherwise the update trips the unique index on endpoint and the device
      // is left pointing at a registration the push service has abandoned.
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: {
          endpoint: "https://push.example/new",
          NOT: { id: "sub_1" },
        },
      });
    });

    it("refuses a rotation whose old endpoint we never registered", async () => {
      prisma.pushSubscription.findUnique.mockResolvedValue(null);

      // The old endpoint is the only credential this request carries, so an
      // unknown one is simply not authorized to move anything.
      await expect(
        pushService.rotate({
          oldEndpoint: "https://push.example/unknown",
          endpoint: "https://push.example/new",
          keys: { p256dh: "p", auth: "a" },
        })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.pushSubscription.update).not.toHaveBeenCalled();
    });
  });

  describe("notification level", () => {
    it("reads the member's level for that org", async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        notifyLevel: "ADDRESSED_TO_ME",
      });

      await expect(
        pushService.getNotifyLevel("user_1", "org_1")
      ).resolves.toBe("ADDRESSED_TO_ME");
      expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_userId: {
              organizationId: "org_1",
              userId: "user_1",
            },
          },
        })
      );
    });

    it("falls back to the default rather than failing a settings page", async () => {
      // Membership is already verified by the route middleware, so a missing
      // row here is a bug, not a permission answer.
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      await expect(pushService.getNotifyLevel("user_1", "org_1")).resolves.toBe(
        "ALL"
      );
    });

    it("writes the level scoped to the calling user's membership", async () => {
      prisma.organizationMember.update.mockResolvedValue({
        notifyLevel: "NONE",
      });

      await expect(
        pushService.setNotifyLevel("user_1", "org_1", "NONE")
      ).resolves.toBe("NONE");
      expect(prisma.organizationMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_userId: {
              organizationId: "org_1",
              userId: "user_1",
            },
          },
          data: { notifyLevel: "NONE" },
        })
      );
    });
  });

  describe("unsubscribe", () => {
    it("scopes the delete to the calling user", async () => {
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });

      await pushService.unsubscribe("user_1", "https://push.example/abc");

      // Scoped by userId so one account cannot silence another's device by
      // guessing an endpoint.
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_1", endpoint: "https://push.example/abc" },
      });
    });

    it("treats an already-removed subscription as success", async () => {
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        pushService.unsubscribe("user_1", "https://push.example/gone")
      ).resolves.toBeUndefined();
    });
  });

  describe("listForUser", () => {
    it("returns only that user's devices, newest first", async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([]);
      await pushService.listForUser("user_1");
      expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user_1" },
          orderBy: { createdAt: "desc" },
        })
      );
    });
  });

  describe("getNotifySettings", () => {
    beforeEach(() => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        notifyLevel: "ALL",
      });
      prisma.inboxAccount.findMany.mockResolvedValue([
        { id: "inbox_2", name: "Sales", email: "sales@acme.test" },
        { id: "inbox_1", name: "Support", email: "support@acme.test" },
      ]);
      prisma.inboxNotifyRule.findMany.mockResolvedValue([]);
    });

    it("offers only the mailboxes the caller can read", async () => {
      await pushService.getNotifySettings("user_1", "org_1");

      // The settings page must not be a directory of mailboxes somebody was
      // never given — it offers exactly what their inbox already shows them.
      expect(prisma.inboxAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org_1", id: { in: ["inbox_1", "inbox_2"] } },
        })
      );
    });

    it("shows every mailbox in the org to an owner, who holds no grants", async () => {
      access.resolveMailboxAccess.mockResolvedValue({
        userId: "user_1",
        organizationId: "org_1",
        unrestricted: true,
        inboxAccountIds: [],
        smtpConnectionIds: [],
      });

      await pushService.getNotifySettings("user_1", "org_1");

      // `unrestricted` means no grant rows exist; filtering on the empty list
      // would hand an owner an empty page.
      expect(prisma.inboxAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org_1" } })
      );
    });

    it("defaults every mailbox to notifying when no rules exist", async () => {
      const settings = await pushService.getNotifySettings("user_1", "org_1");

      expect(settings.domains).toHaveLength(1);
      expect(settings.domains[0]).toMatchObject({
        domain: "acme.test",
        state: "ALL",
      });
      // Sorted by address, not by whatever order the rows arrived in.
      expect(settings.domains[0].mailboxes.map((m) => m.email)).toEqual([
        "sales@acme.test",
        "support@acme.test",
      ]);
      expect(settings.domains[0].mailboxes.every((m) => m.enabled)).toBe(true);
    });

    it("reports a domain as SOME when its mailboxes disagree", async () => {
      prisma.inboxNotifyRule.findMany.mockResolvedValue([
        {
          scope: "MAILBOX",
          domain: null,
          inboxAccountId: "inbox_1",
          enabled: false,
        },
      ]);

      const settings = await pushService.getNotifySettings("user_1", "org_1");

      // Derived from the ticks rather than read off a domain rule: a switch
      // claiming "all" over an unticked row is the kind of small lie that
      // makes people stop trusting the page.
      expect(settings.domains[0].state).toBe("SOME");
      const support = settings.domains[0].mailboxes.find(
        (mailbox) => mailbox.inboxAccountId === "inbox_1"
      );
      expect(support).toMatchObject({ enabled: false, explicit: true });
    });

    it("applies a domain rule to every mailbox under it", async () => {
      prisma.inboxNotifyRule.findMany.mockResolvedValue([
        {
          scope: "DOMAIN",
          domain: "acme.test",
          inboxAccountId: null,
          enabled: false,
        },
      ]);

      const settings = await pushService.getNotifySettings("user_1", "org_1");

      expect(settings.domains[0].state).toBe("NONE");
      // Inherited, not explicit: nobody ticked these individually.
      expect(settings.domains[0].mailboxes.every((m) => !m.explicit)).toBe(true);
    });
  });

  describe("setNotifyRule", () => {
    beforeEach(() => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        notifyLevel: "ALL",
      });
      prisma.inboxAccount.findMany.mockResolvedValue([
        { id: "inbox_1", name: "Support", email: "support@acme.test" },
        { id: "inbox_2", name: "Sales", email: "sales@acme.test" },
      ]);
      prisma.inboxNotifyRule.findMany.mockResolvedValue([]);
      prisma.inboxNotifyRule.findFirst.mockResolvedValue(null);
      prisma.inboxNotifyRule.deleteMany.mockResolvedValue({ count: 0 });
      prisma.inboxNotifyRule.upsert.mockResolvedValue({});
      prisma.inboxAccount.findFirst.mockResolvedValue({
        id: "inbox_1",
        email: "support@acme.test",
      });
    });

    it("refuses a mailbox the caller has no access to", async () => {
      prisma.inboxAccount.findFirst.mockResolvedValue(null);

      await expect(
        pushService.setNotifyRule("user_1", {
          organizationId: "org_1",
          enabled: false,
          target: { scope: "MAILBOX", inboxAccountId: "inbox_9" },
        })
      ).rejects.toMatchObject({ statusCode: 404 });

      expect(prisma.inboxNotifyRule.upsert).not.toHaveBeenCalled();
    });

    it("stores a mute as a row, since it disagrees with the default", async () => {
      await pushService.setNotifyRule("user_1", {
        organizationId: "org_1",
        enabled: false,
        target: { scope: "MAILBOX", inboxAccountId: "inbox_1" },
      });

      expect(prisma.inboxNotifyRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_inboxAccountId: { userId: "user_1", inboxAccountId: "inbox_1" },
          },
          create: expect.objectContaining({
            scope: "MAILBOX",
            inboxAccountId: "inbox_1",
            enabled: false,
          }),
        })
      );
    });

    it("deletes the row instead of storing one that agrees with the default", async () => {
      await pushService.setNotifyRule("user_1", {
        organizationId: "org_1",
        enabled: true,
        target: { scope: "MAILBOX", inboxAccountId: "inbox_1" },
      });

      // Re-ticking means "follow the default again", not "pin true forever" —
      // storing it would freeze today's default into a row nobody remembers.
      expect(prisma.inboxNotifyRule.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_1", inboxAccountId: "inbox_1" },
      });
      expect(prisma.inboxNotifyRule.upsert).not.toHaveBeenCalled();
    });

    it("stores an exception inside a muted domain", async () => {
      prisma.inboxNotifyRule.findFirst.mockResolvedValue({ enabled: false });

      await pushService.setNotifyRule("user_1", {
        organizationId: "org_1",
        enabled: true,
        target: { scope: "MAILBOX", inboxAccountId: "inbox_1" },
      });

      // "Nothing from acme.test except support@" — here `true` genuinely
      // disagrees with what the mailbox would otherwise inherit.
      expect(prisma.inboxNotifyRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ enabled: true }),
        })
      );
    });

    it("refuses a domain the caller holds no mailboxes on", async () => {
      await expect(
        pushService.setNotifyRule("user_1", {
          organizationId: "org_1",
          enabled: false,
          target: { scope: "DOMAIN", domain: "elsewhere.test" },
        })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("mutes a domain and clears the ticks beneath it", async () => {
      await pushService.setNotifyRule("user_1", {
        organizationId: "org_1",
        enabled: false,
        target: { scope: "DOMAIN", domain: "ACME.test" },
      });

      // Only the mailboxes this person holds — a domain rule is a filter over
      // their access, never a claim on the domain's other addresses.
      expect(prisma.inboxNotifyRule.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_1", inboxAccountId: { in: ["inbox_1", "inbox_2"] } },
      });
      expect(prisma.inboxNotifyRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_organizationId_domain: {
              userId: "user_1",
              organizationId: "org_1",
              // Lowercased, so it matches what the worker looks up.
              domain: "acme.test",
            },
          },
        })
      );
    });

    it("switching a domain on leaves no rule at all", async () => {
      await pushService.setNotifyRule("user_1", {
        organizationId: "org_1",
        enabled: true,
        target: { scope: "DOMAIN", domain: "acme.test" },
      });

      // On is the default, and having no row is what lets a mailbox added to
      // this domain next month notify without anyone revisiting the page.
      expect(prisma.inboxNotifyRule.upsert).not.toHaveBeenCalled();
      expect(prisma.inboxNotifyRule.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          userId: "user_1",
          scope: "DOMAIN",
          domain: "acme.test",
        },
      });
    });

    it("only ever considers mailboxes the caller can read", async () => {
      await pushService.setNotifyRule("user_1", {
        organizationId: "org_1",
        enabled: false,
        target: { scope: "DOMAIN", domain: "acme.test" },
      });

      // The whole safety property of the domain switch: it is scoped by access
      // first, so "everything on acme.test" can never reach further than the
      // mailboxes this person was granted.
      expect(prisma.inboxAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org_1", id: { in: ["inbox_1", "inbox_2"] } },
        })
      );
    });
  });
});
