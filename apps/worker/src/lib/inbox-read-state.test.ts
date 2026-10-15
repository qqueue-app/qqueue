import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { synchronizeReadState } from "./inbox-read-state.js";

const account = { id: "a1", uidValidity: "99", flagsCursor: 0 };
const pending = {
  id: "m1",
  messageId: "<m1@mail>",
  imapUid: 7,
  imapUidValidity: "99",
  readAt: new Date(),
  readRevision: 3,
};
function client(flags = new Set<string>()) {
  return {
    fetchOne: vi
      .fn()
      .mockResolvedValue({ envelope: { messageId: pending.messageId } }),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
    fetch: vi.fn(async function* () {
      yield { uid: 7, flags };
    }),
  };
}
beforeEach(() => {
  prismaMock.inboundMessage.findMany.mockResolvedValue([] as never);
  prismaMock.inboundMessage.updateMany.mockResolvedValue({ count: 1 });
});
describe("shared IMAP read-state reconciliation", () => {
  it.each(["a1:99:7", "a1:7"])(
    "supports a UID-validity-verified message without an RFC Message-ID (%s)",
    async (messageId) => {
      prismaMock.inboundMessage.findMany.mockResolvedValueOnce([
        { ...pending, messageId },
      ] as never);
      const imap = client();
      imap.fetchOne.mockResolvedValue({
        envelope: { messageId: undefined },
      } as never);
      await synchronizeReadState(imap as unknown as ImapFlow, account);
      expect(imap.messageFlagsAdd).toHaveBeenCalledWith(7, ["\\Seen"], {
        uid: true,
      });
    }
  );
  it.each([true, false])(
    "writes a pending shared read=%s action and acknowledges its exact revision",
    async (read) => {
      prismaMock.inboundMessage.findMany.mockResolvedValueOnce([
        { ...pending, readAt: read ? pending.readAt : null },
      ] as never);
      const imap = client();
      await synchronizeReadState(imap as unknown as ImapFlow, account);
      expect(
        read ? imap.messageFlagsAdd : imap.messageFlagsRemove
      ).toHaveBeenCalledWith(7, ["\\Seen"], { uid: true });
      expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
        where: { id: "m1", readRevision: 3, readPending: true },
        data: { readPending: false, readSyncError: null },
      });
    }
  );
  it("retains failed writeback with a visible error for retry", async () => {
    prismaMock.inboundMessage.findMany.mockResolvedValueOnce([
      pending,
    ] as never);
    const imap = client();
    imap.messageFlagsAdd.mockRejectedValue(new Error("Mailbox unavailable"));
    await synchronizeReadState(imap as unknown as ImapFlow, account);
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", readRevision: 3, readPending: true },
      data: {
        readAttemptedAt: expect.any(Date),
        readSyncError: "Mailbox unavailable",
      },
    });
    expect(prismaMock.inboundMessage.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ readPending: false }),
      })
    );
  });
  it("never writes Seen onto a recreated mailbox's reused UID", async () => {
    prismaMock.inboundMessage.findMany.mockResolvedValueOnce([
      { ...pending, imapUidValidity: "98" },
    ] as never);
    const imap = client();
    await synchronizeReadState(imap as unknown as ImapFlow, account);
    expect(imap.fetchOne).not.toHaveBeenCalled();
    expect(imap.messageFlagsAdd).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          readAttemptedAt: expect.any(Date),
          readSyncError: expect.stringContaining("reconciled"),
        },
      })
    );
  });
  it("checks the remote message identity before applying an action", async () => {
    prismaMock.inboundMessage.findMany.mockResolvedValueOnce([
      pending,
    ] as never);
    const imap = client();
    imap.fetchOne.mockResolvedValue({
      envelope: { messageId: "<different@mail>" },
    });
    await synchronizeReadState(imap as unknown as ImapFlow, account);
    expect(imap.messageFlagsAdd).not.toHaveBeenCalled();
  });
  it("reconciles external unread flags only against an unchanged, acknowledged local revision", async () => {
    prismaMock.inboundMessage.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { id: "m1", imapUid: 7, readRevision: 3 },
      ] as never);
    await synchronizeReadState(client() as unknown as ImapFlow, account);
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: "m1",
        imapUid: 7,
        imapUidValidity: "99",
        readRevision: 3,
        readPending: false,
      },
      data: { readAt: null, readSyncError: null },
    });
    expect(prismaMock.inboxAccount.update).toHaveBeenLastCalledWith({
      where: { id: "a1" },
      data: { flagsCursor: 0 },
    });
  });
  it("reconciles external Seen and restarts the bounded scan at its end", async () => {
    prismaMock.inboundMessage.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { id: "m1", imapUid: 7, readRevision: 3 },
      ] as never);
    await synchronizeReadState(
      client(new Set(["\\Seen"])) as unknown as ImapFlow,
      account
    );
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { readAt: expect.any(Date), readSyncError: null },
      })
    );
    prismaMock.inboundMessage.findMany.mockResolvedValue([] as never);
    await synchronizeReadState(client() as unknown as ImapFlow, {
      ...account,
      flagsCursor: 7,
    });
    expect(prismaMock.inboxAccount.update).toHaveBeenLastCalledWith({
      where: { id: "a1" },
      data: { flagsCursor: 0 },
    });
  });
});
