import { createHash } from "node:crypto";
import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import { processInboxMoves } from "./inbox-moves.js";

const raw = Buffer.from("Message-ID: <m1@mail>\r\n\r\nControlled original");
const hash = createHash("sha256").update(raw).digest("hex");
const base = {
  id: "move1",
  inboundMessageId: "m1",
  inboxAccountId: "a1",
  sourceLocationId: "l1",
  sourceFolderId: "f1",
  targetFolderId: "f2",
  sourcePath: "INBOX",
  targetPath: "Archive",
  sourceUid: 7,
  sourceUidValidity: "99",
  targetUidValidity: null,
  targetUidNext: null,
  targetUid: null,
  sourceHash: null,
  sourceHeaderId: null,
  status: "PENDING",
  message: { messageId: "<m1@mail>" },
};
function imap() {
  let path = "INBOX";
  const state = {
    source: true,
    destination: false,
    loss: false,
    beforeWriteLoss: false,
    result: true,
    sourceReadOnly: false,
    sourceValidity: 99n,
    targetValidity: 100n,
    targetRaw: raw,
    header: "<m1@mail>" as string | undefined,
  };
  const client = {
    capabilities: new Map([["MOVE", true]]),
    mailboxOpen: vi.fn(async (value: string) => {
      path = value;
      return {
        readOnly: value === "INBOX" && state.sourceReadOnly,
        uidValidity:
          value === "INBOX" ? state.sourceValidity : state.targetValidity,
        uidNext: value === "INBOX" ? 8 : state.destination ? 13 : 12,
      };
    }),
    fetchOne: vi.fn(async (uid: number) =>
      path === "INBOX"
        ? state.source && uid === 7
          ? {
              uid,
              source: raw,
              envelope: { messageId: state.header },
              flags: new Set<string>(),
            }
          : false
        : state.destination && uid === 12
          ? {
              uid,
              source: state.targetRaw,
              envelope: { messageId: state.header },
              flags: new Set<string>(),
            }
          : false
    ),
    messageMove: vi.fn(async () => {
      if (state.beforeWriteLoss)
        throw new Error("connection lost before response");
      if (!state.result) return false;
      state.source = false;
      state.destination = true;
      if (state.loss) throw new Error("response lost after move");
      return { uidValidity: 100n, uidMap: new Map([[7, 12]]) };
    }),
    search: vi.fn(async (_query, options) =>
      options?.returnOptions
        ? { count: state.destination ? 1 : 0 }
        : state.destination
          ? [12]
          : []
    ),
    fetch: vi.fn(async function* () {
      if (state.destination)
        yield { uid: 12, source: state.targetRaw, flags: new Set<string>() };
    }),
  };
  return { client, state };
}
async function run(client: ReturnType<typeof imap>["client"], move = base) {
  prismaMock.inboxMove.findMany.mockResolvedValue([move] as never);
  return processInboxMoves(client as unknown as ImapFlow, "a1", () => {});
}
beforeEach(() => {
  prismaMock.inboxMove.findFirst.mockResolvedValue(null);
  prismaMock.inboxMove.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.inboxFolder.findFirst.mockResolvedValue({
    id: "f2",
    path: "Archive",
  } as never);
  prismaMock.inboundMessageLocation.findFirst.mockResolvedValue({
    id: "l1",
    contentHash: null,
  } as never);
  prismaMock.inboundMessageLocation.findUnique.mockResolvedValue(null);
  prismaMock.inboundMessage.findUniqueOrThrow.mockResolvedValue({
    id: "m1",
    readAt: null,
    readRevision: 2,
    flagged: false,
    flagRevision: 3,
  } as never);
});
describe("durable IMAP moves", () => {
  it("verifies both locations and commits a single move without deleting cached writing", async () => {
    const { client } = imap();
    await run(client);
    expect(client.messageMove).toHaveBeenCalledTimes(1);
    expect(client.messageMove).toHaveBeenCalledWith(7, "Archive", {
      uid: true,
    });
    expect(prismaMock.inboxMove.update).toHaveBeenCalledWith({
      where: { id: "move1" },
      data: {
        status: "DONE",
        targetUid: 12,
        error: null,
        attemptedAt: expect.any(Date),
      },
    });
    expect(prismaMock.inboundMessageLocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          inboxFolderId_uidValidity_uid: {
            inboxFolderId: "f2",
            uidValidity: "100",
            uid: 12,
          },
        },
        create: expect.objectContaining({
          inboundMessageId: "m1",
          contentHash: hash,
        }),
      })
    );
    expect(prismaMock.inboundMessage.deleteMany).not.toHaveBeenCalled();
  });
  it("recovers a lost response by inspecting bytes and never repeating the command", async () => {
    const { client, state } = imap();
    state.loss = true;
    await run(client);
    expect(prismaMock.inboxMove.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNCERTAIN" }),
      })
    );
    const prepared = prismaMock.inboxMove.updateMany.mock.calls.find(
      (call) => call[0].data.status === "PROCESSING"
    )![0].data;
    await run(client, { ...base, ...prepared } as never);
    expect(client.messageMove).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboxMove.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DONE" }),
      })
    );
  });
  it("keeps a command that may not have run uncertain instead of automatically replaying it", async () => {
    const { client, state } = imap();
    state.beforeWriteLoss = true;
    await run(client);
    await run(client, {
      ...base,
      status: "UNCERTAIN",
      sourceHash: hash,
      sourceHeaderId: "<m1@mail>",
      targetUidValidity: "100",
    } as never);
    expect(client.messageMove).toHaveBeenCalledTimes(1);
    expect(prismaMock.inboxMove.update).not.toHaveBeenCalled();
  });
  it("does not retire a source without a byte-identical destination", async () => {
    const { client, state } = imap();
    state.source = false;
    state.destination = true;
    state.targetRaw = Buffer.from("wrong message");
    await run(client, {
      ...base,
      status: "PROCESSING",
      sourceHash: hash,
      sourceHeaderId: "<m1@mail>",
      targetUidValidity: "100",
      targetUid: 12,
    } as never);
    expect(client.messageMove).not.toHaveBeenCalled();
    expect(prismaMock.inboundMessageLocation.upsert).not.toHaveBeenCalled();
  });
  it("does not silently use the library's copy/delete fallback when MOVE is unavailable", async () => {
    const { client } = imap();
    client.capabilities.clear();
    await run(client);
    expect(client.messageMove).not.toHaveBeenCalled();
    expect(prismaMock.inboxMove.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error: expect.stringContaining("IMAP MOVE"),
        }),
      })
    );
  });
  it.each([
    "missing target",
    "renamed target",
    "missing source",
    "changed UID validity",
    "wrong message",
  ])("refuses an unsafe source or destination (%s)", async (failure) => {
    const { client, state } = imap();
    if (failure === "missing target")
      prismaMock.inboxFolder.findFirst.mockResolvedValue(null);
    if (failure === "renamed target")
      prismaMock.inboxFolder.findFirst.mockResolvedValue({
        path: "Other",
      } as never);
    if (failure === "missing source")
      prismaMock.inboundMessageLocation.findFirst.mockResolvedValue(null);
    if (failure === "changed UID validity") state.sourceValidity = 101n;
    if (failure === "wrong message") state.header = "<wrong>";
    await run(client);
    expect(client.messageMove).not.toHaveBeenCalled();
  });
  it("does not interpret a source namespace reset as proof of a completed move", async () => {
    const { client, state } = imap();
    state.source = false;
    state.destination = true;
    state.sourceValidity = 101n;
    await run(client, {
      ...base,
      status: "UNCERTAIN",
      sourceHash: hash,
      targetUidValidity: "100",
    } as never);
    expect(prismaMock.inboxMove.update).not.toHaveBeenCalled();
    expect(client.messageMove).not.toHaveBeenCalled();
  });
  it("verifies headerless moved messages through their recorded byte identity", async () => {
    const { client, state } = imap();
    state.header = undefined;
    await run(client, {
      ...base,
      message: { messageId: "a1:f1:99:7" },
    } as never);
    expect(prismaMock.inboxMove.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DONE" }),
      })
    );
  });
  it("reconciles a lost headerless move response using the bounded destination window", async () => {
    const { client, state } = imap();
    state.header = undefined;
    state.destination = true;
    state.source = false;
    await run(client, {
      ...base,
      status: "UNCERTAIN",
      sourceHash: hash,
      sourceHeaderId: null,
      targetUidValidity: "100",
      targetUidNext: 12,
    } as never);
    expect(client.fetch).toHaveBeenCalledWith("12:12", expect.any(Object), {
      uid: true,
    });
    expect(prismaMock.inboxMove.update).toHaveBeenCalled();
  });
  it("will not overwrite a different cached message at the destination", async () => {
    const { client } = imap();
    prismaMock.inboundMessageLocation.findUnique.mockResolvedValue({
      inboundMessageId: "different",
    } as never);
    await run(client);
    expect(prismaMock.inboxMove.update).not.toHaveBeenCalled();
    expect(prismaMock.inboxMove.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNCERTAIN" }),
      })
    );
  });
});

it("does not issue MOVE when the source was opened read-only", async () => {
  const { client, state } = imap();
  state.sourceReadOnly = true;
  await run(client);
  expect(client.messageMove).not.toHaveBeenCalled();
  expect(prismaMock.inboxMove.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "FAILED",
        error: expect.stringContaining("read-only"),
      }),
    })
  );
});
