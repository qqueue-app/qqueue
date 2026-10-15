import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { inboxMoveService } from "./move-service.js";
import { inboxService } from "./service.js";
vi.mock("./service.js", () => ({
  inboxService: { getConversation: vi.fn(), requestSync: vi.fn() },
}));
const input = {
  clientId: "client1",
  sourceLocationId: "l1",
  action: "ARCHIVE" as const,
  scope: "CONVERSATION" as const,
};
const folders = [
  { id: "f1", path: "INBOX", role: "INBOX", isPrimary: true },
  { id: "f2", path: "Archive", role: "ARCHIVE" },
  { id: "f3", path: "Trash", role: "TRASH" },
  { id: "f4", path: "Projects", role: "OTHER" },
];
const source = {
  id: "l1",
  inboundMessageId: "m1",
  inboxFolderId: "f1",
  uid: 7,
  uidValidity: "99",
  folder: folders[0],
};
const batch = {
  id: "b1",
  clientId: "client1",
  createdAt: new Date(),
  moves: [{ id: "op1", status: "PENDING", inboundMessageId: "m1" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
  prismaMock.inboundMessage.findFirst.mockResolvedValue({
    id: "m1",
    inboxAccountId: "a1",
    inboxAccount: { status: "ACTIVE" },
  } as never);
  prismaMock.inboundMessageLocation.findFirst.mockResolvedValue(
    source as never
  );
  prismaMock.inboundMessageLocation.findMany.mockResolvedValue([
    source,
    { ...source, id: "l2", inboundMessageId: "m2", uid: 8 },
  ] as never);
  prismaMock.inboxFolder.findMany.mockResolvedValue(folders as never);
  prismaMock.inboxMoveBatch.findUnique.mockResolvedValue(null);
  prismaMock.inboxMoveBatch.create.mockResolvedValue({ id: "b1" } as never);
  prismaMock.inboxMoveBatch.findUniqueOrThrow.mockResolvedValue(batch as never);
  prismaMock.inboxMove.findFirst.mockResolvedValue(null);
  prismaMock.inboxMove.groupBy.mockResolvedValue([
    { status: "PENDING", _count: { _all: 2 } },
  ] as never);
  vi.mocked(inboxService.getConversation).mockResolvedValue({
    messages: [{ id: "m1" }, { id: "m2" }],
  } as never);
  vi.mocked(inboxService.requestSync).mockResolvedValue({ queued: 1 });
});
const create = (override = {}) =>
  inboxMoveService.create("m1", "org1", "user1", { ...input, ...override });
describe("durable folder move acceptance", () => {
  it("atomically snapshots the conversation and its original folder namespaces", async () => {
    expect(await create()).toMatchObject({
      id: "b1",
      total: 2,
      counts: { PENDING: 2, DONE: 0 },
    });
    expect(prismaMock.inboxMove.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          inboundMessageId: "m1",
          sourceLocationId: "l1",
          sourceUid: 7,
          sourceUidValidity: "99",
          sourceFolderId: "f1",
          targetFolderId: "f2",
          action: "ARCHIVE",
          batchId: "b1",
        }),
        expect.objectContaining({
          inboundMessageId: "m2",
          sourceLocationId: "l2",
          sourceUid: 8,
        }),
      ]),
    });
    expect(prismaMock.emailJob.createMany).not.toHaveBeenCalled();
  });
  it("returns a completed acceptance on a lost-response retry without including new replies", async () => {
    await create();
    const requestHash =
      prismaMock.inboxMoveBatch.create.mock.calls[0][0].data.requestHash;
    prismaMock.inboxMoveBatch.findUnique.mockResolvedValue({
      ...batch,
      requestHash,
    } as never);
    prismaMock.inboundMessageLocation.findFirst.mockResolvedValue(null);
    vi.mocked(inboxService.getConversation).mockResolvedValue({
      messages: [{ id: "new_reply" }],
    } as never);
    expect(await create()).toMatchObject({ clientId: "client1" });
    expect(prismaMock.inboxMove.createMany).toHaveBeenCalledTimes(1);
    expect(inboxService.getConversation).toHaveBeenCalledTimes(1);
  });
  it("rejects changed instructions for an existing retry identity", async () => {
    await create();
    const requestHash =
      prismaMock.inboxMoveBatch.create.mock.calls[0][0].data.requestHash;
    prismaMock.inboxMoveBatch.findUnique.mockResolvedValue({
      ...batch,
      requestHash,
    } as never);
    await expect(create({ action: "TRASH" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(prismaMock.inboxMove.createMany).toHaveBeenCalledTimes(1);
  });
  it("does not let an ungranted member move or inspect a mailbox", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
    prismaMock.inboundMessage.findFirst.mockResolvedValue(null);
    await expect(create()).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      inboxMoveService.recent("m1", "org1", "user1")
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      inboxMoveService.check("m1", "org1", "user1")
    ).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.inboxMoveBatch.findFirst.mockResolvedValue(null);
    await expect(
      inboxMoveService.getBatch("b1", "org1", "user1")
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.inboxMoveBatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "b1",
          organizationId: "org1",
          moves: {
            some: {
              organizationId: "org1",
              message: { inboxAccountId: { in: [] } },
            },
          },
        },
      })
    );
    expect(prismaMock.inboxMove.createMany).not.toHaveBeenCalled();
  });
  it.each([
    "disabled account",
    "missing location",
    "foreign target",
    "same folder",
    "active move",
    "no current locations",
  ])("rejects before creating any partial operation (%s)", async (failure) => {
    let override = {};
    if (failure === "disabled account")
      prismaMock.inboundMessage.findFirst.mockResolvedValue({
        id: "m1",
        inboxAccountId: "a1",
        inboxAccount: { status: "DISABLED" },
      } as never);
    if (failure === "missing location")
      prismaMock.inboundMessageLocation.findFirst.mockResolvedValue(null);
    if (failure === "foreign target")
      override = { action: "MOVE", targetFolderId: "foreign" };
    if (failure === "same folder")
      override = { action: "MOVE", targetFolderId: "f1" };
    if (failure === "active move")
      prismaMock.inboxMove.findFirst.mockResolvedValue({
        id: "previous",
      } as never);
    if (failure === "no current locations")
      prismaMock.inboundMessageLocation.findMany.mockResolvedValue([]);
    await expect(create(override)).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.inboxMoveBatch.create).not.toHaveBeenCalled();
    expect(prismaMock.inboxMove.createMany).not.toHaveBeenCalled();
  });
  it("keeps accepted moves durable if immediate Redis dispatch fails", async () => {
    vi.mocked(inboxService.requestSync).mockRejectedValueOnce(
      new Error("Redis unavailable")
    );
    await expect(create()).resolves.toMatchObject({ id: "b1", total: 2 });
    expect(prismaMock.inboxMove.createMany).toHaveBeenCalledOnce();
  });
  it("moves one message when conversation scope is not requested", async () => {
    await create({ scope: "MESSAGE", action: "TRASH" });
    expect(inboxService.getConversation).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessageLocation.findMany).toHaveBeenCalledWith({
      where: {
        inboundMessageId: { in: ["m1"] },
        inboxFolderId: "f1",
        present: true,
      },
    });
  });
  it.each(["f2", "missing"])(
    "restores Trash to its available original folder or Inbox (%s)",
    async (previous) => {
      prismaMock.inboundMessageLocation.findFirst.mockResolvedValue({
        ...source,
        inboxFolderId: "f3",
        folder: folders[2],
      } as never);
      prismaMock.inboxMove.findFirst
        .mockResolvedValueOnce({ sourceFolderId: previous } as never)
        .mockResolvedValueOnce(null);
      await create({ action: "RESTORE" });
      expect(prismaMock.inboxMove.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            targetFolderId: previous === "f2" ? "f2" : "f1",
          }),
        ]),
      });
    }
  );
  it("does not interpret Restore as a move from a normal folder", async () => {
    await expect(create({ action: "RESTORE" })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
  it("uses the server's All Mail folder as Archive when it has no Archive special use", async () => {
    prismaMock.inboxFolder.findMany.mockResolvedValue([
      folders[0],
      { id: "all", path: "All Mail", role: "ALL" },
    ] as never);
    await create();
    expect(prismaMock.inboxMove.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ targetFolderId: "all" }),
      ]),
    });
  });
  it("returns status counters while bounding the operation details", async () => {
    prismaMock.inboxMoveBatch.findFirst.mockResolvedValue(batch as never);
    prismaMock.inboxMoveBatch.findMany.mockResolvedValue([batch] as never);
    expect(
      await inboxMoveService.getBatch("b1", "org1", "user1")
    ).toMatchObject({ total: 2 });
    expect(await inboxMoveService.recent("m1", "org1", "user1")).toHaveLength(
      1
    );
    expect(
      prismaMock.inboxMoveBatch.findFirst.mock.calls[0][0].select
    ).toMatchObject({ moves: { take: 20 } });
    expect(await inboxMoveService.check("m1", "org1", "user1")).toEqual({
      queued: true,
    });
  });
});
