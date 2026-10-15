import { beforeEach, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import {
  replyPresenceService,
  REPLY_PRESENCE_TTL_MS,
} from "./presence-service.js";
beforeEach(() => {
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "MEMBER",
  } as never);
  prismaMock.inboxAccountGrant.findMany.mockResolvedValue([
    { inboxAccountId: "inbox1" },
  ] as never);
  prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
  prismaMock.inboundMessage.findFirst.mockResolvedValue({
    id: "message1",
  } as never);
});
it("renews one per-user/tab lease after checking the receiving grant", async () => {
  const started = Date.now();
  const result = await replyPresenceService.touch(
    "message1",
    "org1",
    "user1",
    "client1"
  );
  expect(
    prismaMock.inboundMessage.findFirst.mock.calls[0][0]?.where
  ).toMatchObject({
    organizationId: "org1",
    inboxAccountId: { in: ["inbox1"] },
  });
  expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
    started + REPLY_PRESENCE_TTL_MS
  );
  expect(prismaMock.replyPresence.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        organizationId_userId_clientId: {
          organizationId: "org1",
          userId: "user1",
          clientId: "client1",
        },
      },
      update: { inboundMessageId: "message1", expiresAt: result.expiresAt },
    })
  );
  expect(prismaMock.replyPresence.deleteMany).toHaveBeenCalledWith({
    where: { expiresAt: { lte: expect.any(Date) } },
  });
});
it("does not create an indicator for inaccessible mail", async () => {
  prismaMock.inboundMessage.findFirst.mockResolvedValue(null);
  await expect(
    replyPresenceService.touch("hidden", "org1", "user1", "client1")
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(prismaMock.replyPresence.upsert).not.toHaveBeenCalled();
});
it("allows only the caller's indicator to be removed, including after a read grant is revoked", async () => {
  await replyPresenceService.leave("org1", "user1", "client1");
  expect(prismaMock.replyPresence.deleteMany).toHaveBeenCalledWith({
    where: { organizationId: "org1", userId: "user1", clientId: "client1" },
  });
});
it("returns current authorized teammates' names only, without email or writing", async () => {
  prismaMock.replyPresence.findMany.mockResolvedValue([
    {
      clientId: "c1",
      userId: "u1",
      expiresAt: new Date(),
      user: { name: null },
    },
  ] as never);
  const result = await replyPresenceService.list("org1", "inbox1", [
    "message1",
    "message2",
  ]);
  expect(result[0]).toEqual({
    clientId: "c1",
    userId: "u1",
    expiresAt: expect.any(Date),
    name: "A teammate",
  });
  const query = prismaMock.replyPresence.findMany.mock.calls[0][0]!;
  expect(query.where).toMatchObject({
    organizationId: "org1",
    inboundMessageId: { in: ["message1", "message2"] },
    user: {
      members: { some: { organizationId: "org1" } },
      OR: expect.arrayContaining([
        {
          inboxGrants: {
            some: { organizationId: "org1", inboxAccountId: "inbox1" },
          },
        },
      ]),
    },
  });
  expect(query.select).not.toHaveProperty("user.select.email");
});
