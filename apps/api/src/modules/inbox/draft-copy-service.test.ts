import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { inboxDraftCopyService } from "./draft-copy-service.js";
import { storage } from "../../lib/storage.js";
vi.mock("../../lib/storage.js", () => ({ storage: { getObject: vi.fn() } }));
const version = "a".repeat(64);
const bytes = Buffer.from("private image");
const file = {
  id: "f1",
  filename: "logo.png",
  contentType: "image/png",
  size: bytes.length,
  storageKey: "private/hash/logo.png",
  contentHash: createHash("sha256").update(bytes).digest("hex"),
  contentId: "logo",
  storageStatus: "AVAILABLE",
  partIndex: 0,
};
const original = {
  id: "m1",
  subject: "Writing",
  html: '<p>Hello<img src="cid:logo"></p>',
  text: "Hello",
  to: ["to@example.test"],
  cc: ["cc@example.test"],
  remoteDraftBcc: ["hidden@example.test"],
  replyTo: [],
  inReplyTo: "<parent>",
  references: ["<ancestor>", "<parent>"],
  remoteDraftVersion: version,
  remoteDraftFolderId: "drafts1",
  remoteDraftUid: 7,
  remoteDraftUidValidity: "99",
  bodyStatus: "AVAILABLE",
  contentImportPending: false,
  inboxAccount: { email: "mailbox@example.test" },
  attachments: [file],
};
const input = { clientId: "device-copy1", expectedVersion: version };
beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
  prismaMock.inboundMessage.findFirst.mockResolvedValue(original as never);
  prismaMock.inboundMessageLocation.findFirst.mockResolvedValue({
    id: "location1",
  } as never);
  prismaMock.sMTPConnection.findFirst.mockResolvedValue({
    id: "smtp1",
  } as never);
  prismaMock.emailDraft.findFirst.mockResolvedValue(null);
  prismaMock.emailDraft.create.mockResolvedValue({ id: "d1" } as never);
  vi.mocked(storage.getObject).mockResolvedValue(bytes);
});
describe("private copies of external drafts", () => {
  it("freezes recipients, Bcc, rich writing, thread identity and private inline files without editing the original", async () => {
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).resolves.toMatchObject({ id: "d1" });
    expect(prismaMock.emailDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdByUserId: "u1",
          subject: "Writing",
          html: original.html,
          to: original.to,
          cc: original.cc,
          bcc: original.remoteDraftBcc,
          smtpConnectionId: "smtp1",
          mailboxDraftSource: {
            messageId: "m1",
            version,
            reviewedVersion: version,
            inReplyTo: "<parent>",
            references: original.references,
          },
          attachments: {
            create: [
              expect.objectContaining({
                storageKey: file.storageKey,
                cid: "logo",
                createdByUserId: "u1",
              }),
            ],
          },
        }),
      })
    );
    expect(storage.getObject).toHaveBeenCalledWith(file.storageKey);
    expect(prismaMock.inboundMessage.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.inboundAttachment.deleteMany).not.toHaveBeenCalled();
  });
  it("turns plain writing into escaped editable HTML", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue({
      ...original,
      html: null,
      text: "<words> &\nnext",
    } as never);
    await inboxDraftCopyService.prepare("m1", "org1", "u1", input);
    expect(prismaMock.emailDraft.create.mock.calls[0][0].data.html).toBe(
      "<p>&lt;words&gt; &amp;<br>next</p>"
    );
  });
  it("recovers a changed personal copy after a lost preparation response without another file copy", async () => {
    const draft = {
      id: "d1",
      revision: 6,
      mailboxDraftSource: {
        messageId: "m1",
        version,
        reviewedVersion: version,
        references: [],
      },
    };
    prismaMock.emailDraft.findFirst.mockResolvedValue(draft as never);
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).resolves.toEqual(draft);
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });
  it("recognizes a concurrent creation under its stable identity", async () => {
    prismaMock.emailDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "d1",
        mailboxDraftSource: {
          messageId: "m1",
          version,
          reviewedVersion: version,
          references: [],
        },
      } as never);
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).resolves.toMatchObject({ id: "d1" });
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });
  it.each([
    { completedSendId: "job1" },
    { deletedAt: new Date() },
    { mailboxDraftSource: null },
  ])("rejects an invalid or completed retry %j", async (change) => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      mailboxDraftSource: {
        messageId: "m1",
        version,
        reviewedVersion: version,
        references: [],
      },
      ...change,
    } as never);
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each([
    { remoteDraftVersion: "newer" },
    { contentImportPending: true },
    { bodyStatus: "UNAVAILABLE" },
    { attachments: [{ ...file, contentHash: null }] },
    { attachments: [{ ...file, storageStatus: "UNAVAILABLE" }] },
    { attachments: Array.from({ length: 51 }, () => file) },
    { attachments: [{ ...file, size: 1024 ** 3 }] },
    { replyTo: ["a@example.test", "b@example.test"] },
  ])(
    "refuses incomplete, stale or unsupported original content %j",
    async (change) => {
      prismaMock.inboundMessage.findFirst.mockResolvedValue({
        ...original,
        ...change,
      } as never);
      await expect(
        inboxDraftCopyService.prepare("m1", "org1", "u1", input)
      ).rejects.toHaveProperty("statusCode");
      expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    { ...original, remoteDraftVersion: "newer" },
    { ...original, attachments: [] },
  ])(
    "rejects source replacement while its blobs are being checked",
    async (current) => {
      prismaMock.inboundMessage.findFirst
        .mockResolvedValueOnce(original as never)
        .mockResolvedValueOnce(current as never);
      await expect(
        inboxDraftCopyService.prepare("m1", "org1", "u1", input)
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
    }
  );
  it("requires a current Drafts location", async () => {
    prismaMock.inboundMessageLocation.findFirst.mockResolvedValue(null);
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("marks corrupt or missing private bytes for recovery instead of accepting a partial copy", async () => {
    vi.mocked(storage.getObject).mockResolvedValue(Buffer.from("wrong bytes"));
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.inboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { contentImportPending: true },
    });
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });
  it("enforces read scope before exposing content and requires a usable sending account", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
    prismaMock.inboundMessage.findFirst.mockResolvedValueOnce(null);
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      prismaMock.inboundMessage.findFirst.mock.calls[0][0]?.where
    ).toMatchObject({ inboxAccountId: { in: [] } });
    expect(prismaMock.emailDraft.findFirst).not.toHaveBeenCalled();
    prismaMock.sMTPConnection.findFirst.mockResolvedValue(null);
    await expect(
      inboxDraftCopyService.prepare("m1", "org1", "u1", input)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
