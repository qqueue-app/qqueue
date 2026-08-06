import { beforeEach, describe, expect, it, vi } from "vitest";

const webpush = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("web-push", () => ({ default: webpush }));

const prisma = vi.hoisted(() => ({
  pushSubscription: {
    findMany: vi.fn(),
    delete: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock("./prisma.js", () => ({ prisma }));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const env = vi.hoisted(() => ({
  current: {
    VAPID_PUBLIC_KEY: "public-key" as string | undefined,
    VAPID_PRIVATE_KEY: "private-key" as string | undefined,
    VAPID_SUBJECT: "mailto:admin@example.com",
  },
}));
vi.mock("../config/env.js", () => ({
  get env() {
    return env.current;
  },
}));

const subscription = {
  id: "sub_1",
  endpoint: "https://push.example/abc",
  p256dh: "p",
  auth: "a",
};

async function loadModule() {
  // The module memoises its VAPID configuration on first use, so each test
  // needs a fresh copy to exercise a different configuration.
  vi.resetModules();
  return import("./push.js");
}

describe("worker push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.current = {
      VAPID_PUBLIC_KEY: "public-key",
      VAPID_PRIVATE_KEY: "private-key",
      VAPID_SUBJECT: "mailto:admin@example.com",
    };
    prisma.pushSubscription.findMany.mockResolvedValue([subscription]);
    prisma.pushSubscription.updateMany.mockResolvedValue({ count: 1 });
    webpush.sendNotification.mockResolvedValue(undefined);
  });

  it("does nothing when VAPID keys are absent", async () => {
    env.current = {
      VAPID_PUBLIC_KEY: undefined,
      VAPID_PRIVATE_KEY: undefined,
      VAPID_SUBJECT: "mailto:admin@example.com",
    };
    const { sendPushToOrganization, pushEnabled } = await loadModule();

    expect(pushEnabled()).toBe(false);
    const sent = await sendPushToOrganization({
      organizationId: "org_1",
      payload: { title: "t", body: "b" },
    });

    // Push is a convenience layered on the inbox, never a step in delivery:
    // an unconfigured instance must carry on silently, not throw.
    expect(sent).toBe(0);
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it("sends the payload to every registered device in the organization", async () => {
    const { sendPushToOrganization } = await loadModule();

    const sent = await sendPushToOrganization({
      organizationId: "org_1",
      payload: { title: "Kofi", body: "Re: invoice", url: "/inbox?message=1" },
    });

    expect(sent).toBe(1);
    const [target, body] = webpush.sendNotification.mock.calls[0];
    expect(target).toEqual({
      endpoint: subscription.endpoint,
      keys: { p256dh: "p", auth: "a" },
    });
    expect(JSON.parse(body)).toMatchObject({
      title: "Kofi",
      body: "Re: invoice",
      url: "/inbox?message=1",
    });
  });

  it("restricts delivery to named users when asked", async () => {
    const { sendPushToOrganization } = await loadModule();

    await sendPushToOrganization({
      organizationId: "org_1",
      payload: { title: "t", body: "b" },
      userIds: ["user_1"],
    });

    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", userId: { in: ["user_1"] } },
      })
    );
  });

  it("deletes a subscription the push service reports as gone", async () => {
    webpush.sendNotification.mockRejectedValue(
      Object.assign(new Error("gone"), { statusCode: 410 })
    );
    prisma.pushSubscription.delete.mockResolvedValue(subscription);
    const { sendPushToOrganization } = await loadModule();

    const sent = await sendPushToOrganization({
      organizationId: "org_1",
      payload: { title: "t", body: "b" },
    });

    // 404/410 means the client unsubscribed or was uninstalled: that endpoint
    // is dead forever, so retrying it on every future send is pure waste.
    expect(sent).toBe(0);
    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({
      where: { id: "sub_1" },
    });
  });

  it("keeps a subscription that failed for a transient reason", async () => {
    webpush.sendNotification.mockRejectedValue(
      Object.assign(new Error("boom"), { statusCode: 500 })
    );
    const { sendPushToOrganization } = await loadModule();

    const sent = await sendPushToOrganization({
      organizationId: "org_1",
      payload: { title: "t", body: "b" },
    });

    expect(sent).toBe(0);
    expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
  });

  it("shortens long text so a notification banner can show it", async () => {
    const { truncateForNotification } = await loadModule();

    expect(truncateForNotification("  hello   there  ")).toBe("hello there");
    expect(truncateForNotification("x".repeat(200))).toHaveLength(120);
    expect(truncateForNotification("x".repeat(200)).endsWith("…")).toBe(true);
  });
});
