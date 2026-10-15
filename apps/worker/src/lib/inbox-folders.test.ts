import { createHash } from "node:crypto";
import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import {
  discoverFolders,
  folderRole,
  matchesRemoteIdentity,
} from "./inbox-folders.js";

beforeEach(() => {
  prismaMock.inboxFolder.findMany.mockResolvedValue([]);
});
describe("folder discovery", () => {
  it.each([
    ["INBOX", undefined, "INBOX"],
    ["Sent Items", "\\Sent", "SENT"],
    ["Saved", "\\Drafts", "DRAFTS"],
    ["Keep", "\\Archive", "ARCHIVE"],
    ["Bin", "\\Trash", "TRASH"],
    ["Spam", "\\Junk", "JUNK"],
    ["Mail", "\\All", "ALL"],
    ["Project", undefined, "OTHER"],
    ["Unknown", "\\Unknown", "OTHER"],
  ])(
    "classifies %s by server special-use metadata",
    (path, specialUse, role) => {
      expect(folderRole({ path, specialUse })).toBe(role);
    }
  );
  it("stores selectable paths and preserves progress on rediscovery", async () => {
    const list = vi.fn().mockResolvedValue([
      { path: "INBOX", name: "Inbox", flags: new Set() },
      { path: "Sent Items", name: "", specialUse: "\\Sent", flags: new Set() },
      { path: "Parent", name: "Parent", flags: new Set(["\\Noselect"]) },
    ]);
    await discoverFolders({ list } as unknown as ImapFlow, "a1", "INBOX");
    expect(prismaMock.inboxFolder.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.inboxFolder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          inboxAccountId_path: { inboxAccountId: "a1", path: "Sent Items" },
        },
        update: {
          name: "Sent Items",
          role: "SENT",
          specialUse: "\\Sent",
          present: true,
          isPrimary: false,
        },
      })
    );
    expect(prismaMock.inboxFolder.updateMany).toHaveBeenCalledWith({
      where: { inboxAccountId: "a1", path: { notIn: ["INBOX", "Sent Items"] } },
      data: { present: false },
    });
    expect(prismaMock.inboxFolder.deleteMany).not.toHaveBeenCalled();
  });
  it("does not mark any folder missing when LIST fails", async () => {
    const list = vi.fn().mockRejectedValue(new Error("Interrupted LIST"));
    await expect(
      discoverFolders({ list } as unknown as ImapFlow, "a1", "INBOX")
    ).rejects.toThrow("Interrupted LIST");
    expect(prismaMock.inboxFolder.updateMany).not.toHaveBeenCalled();
  });
  it("scopes a headerless identity to its exact folder UID namespace", () => {
    const input = {
      accountId: "a1",
      folderId: "f1",
      uidValidity: "99",
      uid: 7,
      messageId: "a1:f1:99:7",
    };
    expect(matchesRemoteIdentity(input)).toBe(true);
    expect(matchesRemoteIdentity({ ...input, uidValidity: "100" })).toBe(false);
    expect(matchesRemoteIdentity({ ...input, folderId: "f2" })).toBe(false);
    expect(
      matchesRemoteIdentity({ ...input, remoteMessageId: "<other>" })
    ).toBe(false);
  });
});

it("verifies a moved headerless message by bytes in its new UID namespace", () => {
  const source = Buffer.from("Original message bytes");
  const input = {
    accountId: "a1",
    folderId: "new",
    uidValidity: "100",
    uid: 12,
    messageId: "a1:old:99:7",
    contentHash: createHash("sha256").update(source).digest("hex"),
  };
  expect(matchesRemoteIdentity({ ...input, source })).toBe(true);
  expect(
    matchesRemoteIdentity({ ...input, source: Buffer.from("Different bytes") })
  ).toBe(false);
  expect(matchesRemoteIdentity(input)).toBe(false);
});
