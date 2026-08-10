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
  organizationMember: {
    findMany: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
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
  userId: "user_1",
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org_1",
    messageId: "msg_1",
    sender: "Kofi <kofi@example.com>",
    subject: "Re: invoice",
    threadKey: "thread_1",
    recipientEmails: ["support@acme.test"],
    ...overrides,
  };
}

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
    prisma.organizationMember.findMany.mockResolvedValue([
      {
        userId: "user_1",
        notifyLevel: "ALL",
        user: { email: "ama@acme.test" },
      },
    ]);
    prisma.organization.findUnique.mockResolvedValue({ name: "Acme" });
    webpush.sendNotification.mockResolvedValue(undefined);
  });

  it("does nothing when VAPID keys are absent", async () => {
    env.current = {
      VAPID_PUBLIC_KEY: undefined,
      VAPID_PRIVATE_KEY: undefined,
      VAPID_SUBJECT: "mailto:admin@example.com",
    };
    const { notifyNewInboundMessage, pushEnabled } = await loadModule();

    expect(pushEnabled()).toBe(false);
    const sent = await notifyNewInboundMessage(message());

    // Push is a convenience layered on the inbox, never a step in delivery:
    // an unconfigured instance must carry on silently, not throw.
    expect(sent).toBe(0);
    expect(prisma.organizationMember.findMany).not.toHaveBeenCalled();
  });

  it("sends to every device of every member who wants all mail", async () => {
    const { notifyNewInboundMessage } = await loadModule();

    const sent = await notifyNewInboundMessage(message());

    expect(sent).toBe(1);
    const [target, body] = webpush.sendNotification.mock.calls[0];
    expect(target).toEqual({
      endpoint: subscription.endpoint,
      keys: { p256dh: "p", auth: "a" },
    });
    expect(JSON.parse(body)).toMatchObject({
      title: "Kofi <kofi@example.com>",
      body: "Re: invoice",
      url: "/inbox?org=org_1&message=msg_1",
      tag: "inbox:thread_1",
    });
  });

  it("never asks the database for members who muted the org", async () => {
    const { notifyNewInboundMessage } = await loadModule();

    await notifyNewInboundMessage(message());

    expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", notifyLevel: { not: "NONE" } },
      })
    );
  });

  it("skips an ADDRESSED_TO_ME member when the mail went elsewhere", async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      {
        userId: "user_1",
        notifyLevel: "ADDRESSED_TO_ME",
        user: { email: "ama@acme.test" },
      },
    ]);
    const { notifyNewInboundMessage } = await loadModule();

    // Addressed to the shared mailbox, not to Ama: this is exactly why
    // ADDRESSED_TO_ME is not the default on a team inbox.
    const sent = await notifyNewInboundMessage(message());

    expect(sent).toBe(0);
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it("notifies an ADDRESSED_TO_ME member written to in Cc, whatever the casing", async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      {
        userId: "user_1",
        notifyLevel: "ADDRESSED_TO_ME",
        user: { email: "ama@acme.test" },
      },
    ]);
    const { notifyNewInboundMessage } = await loadModule();

    const sent = await notifyNewInboundMessage(
      message({ recipientEmails: ["support@acme.test", " AMA@Acme.test "] })
    );

    expect(sent).toBe(1);
  });

  it("names the organization only for people who belong to more than one", async () => {
    prisma.organizationMember.findMany
      // The interested members of this org…
      .mockResolvedValueOnce([
        { userId: "user_1", notifyLevel: "ALL", user: { email: "a@x.test" } },
        { userId: "user_2", notifyLevel: "ALL", user: { email: "b@x.test" } },
      ])
      // …then every membership those two hold anywhere.
      .mockResolvedValueOnce([
        { userId: "user_1" },
        { userId: "user_2" },
        { userId: "user_2" },
      ]);
    prisma.pushSubscription.findMany.mockResolvedValue([
      { ...subscription, id: "sub_1", userId: "user_1" },
      { ...subscription, id: "sub_2", userId: "user_2" },
    ]);
    const { notifyNewInboundMessage } = await loadModule();

    await notifyNewInboundMessage(message());

    const bodies = webpush.sendNotification.mock.calls.map(
      ([, payload]) => JSON.parse(payload).body
    );
    // Someone in a single org already knows which inbox this is; someone in two
    // cannot tell without being told.
    expect(bodies).toContain("Re: invoice");
    expect(bodies).toContain("Re: invoice · Acme");
  });

  it("deletes a subscription the push service reports as gone", async () => {
    webpush.sendNotification.mockRejectedValue(
      Object.assign(new Error("gone"), { statusCode: 410 })
    );
    prisma.pushSubscription.delete.mockResolvedValue(subscription);
    const { notifyNewInboundMessage } = await loadModule();

    const sent = await notifyNewInboundMessage(message());

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
    const { notifyNewInboundMessage } = await loadModule();

    const sent = await notifyNewInboundMessage(message());

    expect(sent).toBe(0);
    expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
  });

  it("shortens long text so a notification banner can show it", async () => {
    const { truncateForNotification } = await loadModule();

    expect(truncateForNotification("  hello   there  ")).toBe("hello there");
    expect(truncateForNotification("x".repeat(200))).toHaveLength(120);
    expect(truncateForNotification("x".repeat(200)).endsWith("…")).toBe(true);
  });

  describe("sendPushToUsers", () => {
    it("gives each recipient their own payload", async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { ...subscription, id: "sub_1", userId: "user_1" },
        { ...subscription, id: "sub_2", userId: "user_2" },
      ]);
      const { sendPushToUsers } = await loadModule();

      const sent = await sendPushToUsers([
        { userId: "user_1", payload: { title: "t", body: "for one" } },
        { userId: "user_2", payload: { title: "t", body: "for two" } },
      ]);

      expect(sent).toBe(2);
      const bodies = webpush.sendNotification.mock.calls.map(
        ([, payload]) => JSON.parse(payload).body
      );
      expect(bodies).toEqual(expect.arrayContaining(["for one", "for two"]));
    });

    it("does not query at all for an empty recipient list", async () => {
      const { sendPushToUsers } = await loadModule();

      expect(await sendPushToUsers([])).toBe(0);
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    });
  });
});
