import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  pushSubscription: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
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
        organizationId: "org_1",
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
        userAgent: "Chrome on macOS",
      });

      const call = prisma.pushSubscription.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ endpoint: "https://push.example/abc" });
      expect(call.create).toMatchObject({
        userId: "user_1",
        organizationId: "org_1",
        p256dh: "p",
        auth: "a",
        userAgent: "Chrome on macOS",
      });
    });

    it("reassigns ownership on update, since browsers recycle endpoints", async () => {
      prisma.pushSubscription.upsert.mockResolvedValue({
        id: "sub_1",
        endpoint: "https://push.example/abc",
        createdAt: new Date(),
      });

      await pushService.subscribe("user_2", {
        organizationId: "org_1",
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
      });

      // Without this, a shared device would keep pushing one org's mail to
      // whoever registered the endpoint first.
      expect(prisma.pushSubscription.upsert.mock.calls[0][0].update).toMatchObject(
        { userId: "user_2", organizationId: "org_1" }
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
