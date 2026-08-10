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
}));
vi.mock("../../lib/prisma.js", () => ({ prisma }));

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
});
