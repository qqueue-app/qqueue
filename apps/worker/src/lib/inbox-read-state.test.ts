import { createHash } from "node:crypto";
import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { synchronizeReadState } from "./inbox-read-state.js";

const folder = {
  id: "f1",
  inboxAccountId: "a1",
  uidValidity: "99",
  flagsCursor: 0,
};
const message = {
  id: "m1",
  messageId: "<m1@mail>",
  readAt: new Date(),
  readRevision: 3,
  readPending: true,
  flagged: false,
  flagRevision: 2,
  flagPending: false,
};
function location(overrides = {}) {
  return {
    id: "l1",
    inboundMessageId: "m1",
    uid: 7,
    uidValidity: "99",
    remoteSeen: true,
    remoteFlagged: false,
    readAppliedRevision: 2,
    flagAppliedRevision: 2,
    message,
    ...overrides,
  };
}
function client(
  flags?: Set<string>,
  identity = message.messageId,
  exists = true
) {
  return {
    fetchOne: vi
      .fn()
      .mockResolvedValue(
        exists ? { envelope: { messageId: identity } } : false
      ),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
    fetch: vi.fn(async function* () {
      if (exists) yield { uid: 7, flags, envelope: { messageId: identity } };
    }),
  };
}
function sync(imap: ReturnType<typeof client>, cursor = 0) {
  return synchronizeReadState(imap as unknown as ImapFlow, {
    ...folder,
    flagsCursor: cursor,
  });
}
beforeEach(() => {
  prismaMock.inboundMessageLocation.findMany.mockResolvedValue([]);
  prismaMock.inboundMessage.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.inboundMessageLocation.updateMany.mockResolvedValue({ count: 1 });
});
describe("shared folder Seen and Flagged reconciliation", () => {
  it.each(["a1:f1:99:7", "a1:99:7", "a1:7"])(
    "verifies a headerless message through its folder namespace (%s)",
    async (messageId) => {
      prismaMock.inboundMessageLocation.findMany.mockResolvedValueOnce([
        location({ message: { ...message, messageId } }),
      ] as never);
      const imap = client();
      imap.fetchOne.mockResolvedValue({
        envelope: { messageId: undefined },
      } as never);
      await sync(imap);
      expect(imap.messageFlagsAdd).toHaveBeenCalledWith(7, ["\\Seen"], {
        uid: true,
      });
      // A missing RFC header must not match a different UID/folder namespace.
      expect(prismaMock.inboundMessageLocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            inboxFolderId: "f1",
            uidValidity: "99",
            present: true,
          }),
        })
      );
    }
  );
  it.each([true, false])(
    "writes read=%s and acknowledges only when every current copy has the same revision",
    async (read) => {
      prismaMock.inboundMessageLocation.findMany.mockResolvedValueOnce([
        location({
          message: { ...message, readAt: read ? message.readAt : null },
        }),
      ] as never);
      const imap = client();
      await sync(imap);
      expect(
        read ? imap.messageFlagsAdd : imap.messageFlagsRemove
      ).toHaveBeenCalledWith(7, ["\\Seen"], { uid: true });
      expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
        where: {
          id: "m1",
          readRevision: 3,
          readPending: true,
          locations: {
            none: {
              present: true,
              folder: { present: true },
              readAppliedRevision: { not: 3 },
            },
          },
        },
        data: { readPending: false, readSyncError: null },
      });
    }
  );
  it.each([true, false])(
    "writes flagged=%s without changing Seen",
    async (flagged) => {
      prismaMock.inboundMessageLocation.findMany.mockResolvedValueOnce([
        location({
          flagAppliedRevision: 1,
          message: {
            ...message,
            readPending: false,
            flagged,
            flagPending: true,
          },
        }),
      ] as never);
      const imap = client();
      await sync(imap);
      expect(
        flagged ? imap.messageFlagsAdd : imap.messageFlagsRemove
      ).toHaveBeenCalledWith(7, ["\\Flagged"], { uid: true });
      expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            flagRevision: 2,
            flagPending: true,
          }),
          data: { flagPending: false, flagSyncError: null },
        })
      );
    }
  );
  it("does not repeat an already applied action while another folder copy is pending", async () => {
    prismaMock.inboundMessageLocation.findMany.mockResolvedValueOnce([
      location({ readAppliedRevision: 3 }),
    ] as never);
    prismaMock.inboundMessage.updateMany.mockResolvedValue({ count: 0 });
    const imap = client();
    expect(await sync(imap)).toBe(true);
    expect(imap.messageFlagsAdd).not.toHaveBeenCalled();
  });
  it.each([false, new Error("Offline"), "Disconnected"])(
    "retains unconfirmed writes for retry (%s)",
    async (error) => {
      prismaMock.inboundMessageLocation.findMany.mockResolvedValueOnce([
        location(),
      ] as never);
      const imap = client();
      if (error === false) imap.messageFlagsAdd.mockResolvedValue(false);
      else imap.messageFlagsAdd.mockRejectedValue(error);
      await sync(imap);
      expect(prismaMock.inboundMessageLocation.updateMany).toHaveBeenCalledWith(
        { where: { id: "l1" }, data: { attemptedAt: expect.any(Date) } }
      );
      expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "m1", readRevision: 3, readPending: true },
          data: { readSyncError: expect.any(String) },
        })
      );
      expect(prismaMock.inboundMessage.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { readPending: false, readSyncError: null },
        })
      );
    }
  );
  it.each([false, true])(
    "never changes flags for a disappeared or reused UID (remote exists=%s)",
    async (exists) => {
      prismaMock.inboundMessageLocation.findMany.mockResolvedValueOnce([
        location(),
      ] as never);
      const imap = client(undefined, "<different@mail>", exists);
      await sync(imap);
      expect(imap.messageFlagsAdd).not.toHaveBeenCalled();
      expect(prismaMock.inboundMessageLocation.updateMany).toHaveBeenCalledWith(
        { where: { id: "l1" }, data: { present: false } }
      );
    }
  );
  it.each([true, false])(
    "promotes an external Seen=%s transition to a new shared revision",
    async (seen) => {
      prismaMock.inboundMessageLocation.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          location({
            remoteSeen: !seen,
            message: { ...message, readPending: false },
          }),
        ] as never);
      await sync(client(new Set(seen ? ["\\Seen"] : [])));
      expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
        where: { id: "m1", readRevision: 3, readPending: false },
        data: {
          readAt: seen ? expect.any(Date) : null,
          readRevision: { increment: 1 },
          readPending: true,
          readSyncError: null,
        },
      });
      expect(prismaMock.inboundMessageLocation.updateMany).toHaveBeenCalledWith(
        { where: { id: "l1" }, data: { readAppliedRevision: 4 } }
      );
    }
  );
  it("promotes an external Flagged transition without advancing the read revision", async () => {
    prismaMock.inboundMessageLocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        location({ message: { ...message, readPending: false } }),
      ] as never);
    expect(await sync(client(new Set(["\\Seen", "\\Flagged"])))).toBe(true);
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", flagRevision: 2, flagPending: false },
      data: {
        flagged: true,
        flagRevision: { increment: 1 },
        flagPending: true,
        flagSyncError: null,
      },
    });
  });
  it("does not acknowledge an external result when a newer action has raced it", async () => {
    prismaMock.inboundMessageLocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([location()] as never);
    prismaMock.inboundMessage.updateMany.mockResolvedValue({ count: 0 });
    await sync(client(new Set()));
    expect(
      prismaMock.inboundMessageLocation.updateMany
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { readAppliedRevision: 4 } })
    );
  });
  it("treats missing flags as unavailable, not as Seen and Flagged removal", async () => {
    prismaMock.inboundMessageLocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([location()] as never);
    await sync(client());
    expect(prismaMock.inboundMessage.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessageLocation.updateMany).not.toHaveBeenCalled();
  });
  it("retains cached content while reconciling an expunged location", async () => {
    prismaMock.inboundMessageLocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([location()] as never);
    await sync(client(undefined, "<other>", false));
    expect(prismaMock.inboundMessageLocation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["l1"] } },
      data: { present: false },
    });
    expect(prismaMock.inboundMessage.deleteMany).not.toHaveBeenCalled();
  });
  it("rejects a reused UID during the observation scan", async () => {
    prismaMock.inboundMessageLocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([location()] as never);
    await sync(client(new Set(), "<other>"));
    expect(prismaMock.inboundMessage.updateMany).not.toHaveBeenCalled();
  });
  it("wraps a finished folder scan and advances a full bounded page", async () => {
    prismaMock.inboundMessageLocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await sync(client(), 7);
    expect(prismaMock.inboxFolder.update).toHaveBeenLastCalledWith({
      where: { id: "f1" },
      data: { flagsCursor: 0 },
    });
    prismaMock.inboundMessageLocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        Array.from({ length: 200 }, (_, i) =>
          location({ id: `l${i}`, uid: i + 1 })
        ) as never
      );
    await sync(client());
    expect(prismaMock.inboxFolder.update).toHaveBeenLastCalledWith({
      where: { id: "f1" },
      data: { flagsCursor: 200 },
    });
  });
});

it("verifies bytes before writing Seen on a moved headerless message", async () => {
  const raw = Buffer.from("Original headerless message");
  const row = location({
    uid: 12,
    contentHash: createHash("sha256").update(raw).digest("hex"),
    message: { ...message, messageId: "a1:old:98:7" },
  });
  prismaMock.inboundMessageLocation.findMany.mockResolvedValueOnce([
    row,
  ] as never);
  const imap = client();
  imap.fetchOne
    .mockResolvedValueOnce({ uid: 12, envelope: {} } as never)
    .mockResolvedValueOnce({ uid: 12, envelope: {}, source: raw } as never);
  await sync(imap);
  expect(imap.messageFlagsAdd).toHaveBeenCalledWith(12, ["\\Seen"], {
    uid: true,
  });
});
it("bounds headerless identity checks and resumes the unverified remainder", async () => {
  const raw = Buffer.from("Controlled headerless bytes");
  const rows = Array.from({ length: 12 }, (_, i) =>
    location({
      id: `l${i}`,
      uid: i + 1,
      contentHash: createHash("sha256").update(raw).digest("hex"),
      message: { ...message, messageId: "a1:old:98:7", readPending: false },
    })
  );
  const imap = client(new Set(["\\Seen"]));
  imap.fetch.mockImplementation(async function* (uids) {
    for (const uid of uids)
      yield { uid, flags: new Set(["\\Seen"]), envelope: {} };
  } as never);
  imap.fetchOne.mockImplementation(
    async (uid) =>
      ({ uid, source: raw, flags: new Set(["\\Seen"]), envelope: {} }) as never
  );
  prismaMock.inboundMessageLocation.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(rows as never);
  await sync(imap);
  expect(imap.fetchOne).toHaveBeenCalledTimes(10);
  expect(prismaMock.inboxFolder.update).toHaveBeenLastCalledWith({
    where: { id: "f1" },
    data: { flagsCursor: 10 },
  });
  prismaMock.inboundMessageLocation.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(rows.slice(10) as never);
  await sync(imap, 10);
  expect(imap.fetchOne).toHaveBeenCalledTimes(12);
  expect(prismaMock.inboxFolder.update).toHaveBeenLastCalledWith({
    where: { id: "f1" },
    data: { flagsCursor: 0 },
  });
  expect(prismaMock.inboundMessageLocation.updateMany).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: { present: false } })
  );
});
