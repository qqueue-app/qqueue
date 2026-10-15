import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "../test/prisma-mock.js";
import {
  mailboxDraftSource,
  mailboxDraftStatus,
} from "./mailbox-draft-source.js";
import { emailDraftService } from "../modules/email-drafts/service.js";
const source = {
  messageId: "m1",
  version: "v1",
  reviewedVersion: "v1",
  references: [],
};
const message = {
  id: "m1",
  remoteDraftVersion: "v1",
  remoteDraftFolderId: "f1",
  remoteDraftUid: 7,
  remoteDraftUidValidity: "99",
  bodyStatus: "AVAILABLE",
  contentImportPending: false,
  subject: "External writing",
  html: "<p>Original</p>",
  text: "Original",
  to: ["to@example.test"],
  cc: [],
  remoteDraftBcc: ["hidden@example.test"],
  attachments: [],
};
const draft = {
  id: "d1",
  organizationId: "org1",
  revision: 4,
  mailboxDraftSource: source,
};
beforeEach(() => {
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    role: "OWNER",
  } as never);
  prismaMock.inboundMessage.findFirst.mockResolvedValue(message as never);
  prismaMock.inboundMessageLocation.findFirst.mockResolvedValue({
    id: "l1",
  } as never);
  prismaMock.emailDraft.findFirst.mockResolvedValue(draft as never);
  prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.emailDraft.findFirstOrThrow.mockResolvedValue({
    ...draft,
    revision: 5,
  } as never);
});
describe("reviewing the last synced external draft", () => {
  it("exposes authorized original writing and Bcc only to the owning private copy", async () => {
    await expect(
      emailDraftService.sourceStatus("d1", "u1")
    ).resolves.toMatchObject({
      state: "UNCHANGED",
      reviewed: true,
      source: { bcc: message.remoteDraftBcc },
    });
    expect(prismaMock.emailDraft.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", createdByUserId: "u1", deletedAt: null },
    });
  });
  it("requires deliberate review of a changed version", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue({
      ...message,
      remoteDraftVersion: "v2",
    } as never);
    await expect(
      mailboxDraftStatus(source, "org1", "u1")
    ).resolves.toMatchObject({ state: "UPDATED", reviewed: false });
    await emailDraftService.reviewSource("d1", "u1", {
      expectedRevision: 4,
      expectedVersion: "v2",
    });
    expect(prismaMock.emailDraft.updateMany).toHaveBeenCalledWith({
      where: {
        id: "d1",
        createdByUserId: "u1",
        revision: 4,
        deletedAt: null,
        completedSendId: null,
      },
      data: {
        revision: { increment: 1 },
        mailboxDraftSource: { ...source, reviewedVersion: "v2" },
      },
    });
  });
  it.each([{ remoteDraftVersion: null }, null])(
    "treats missing source as unavailable and retains private writing",
    async (value) => {
      prismaMock.inboundMessage.findFirst.mockResolvedValue(value as never);
      await expect(mailboxDraftStatus(source, "org1", "u1")).resolves.toEqual({
        state: "UNAVAILABLE",
        currentVersion: "unavailable",
        reviewed: false,
      });
      await emailDraftService.reviewSource("d1", "u1", {
        expectedRevision: 4,
        expectedVersion: "unavailable",
      });
      expect(
        prismaMock.emailDraft.updateMany.mock.calls[0][0].data
      ).not.toHaveProperty("html");
    }
  );
  it("does not expose a revoked mailbox's writing", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([]);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([]);
    prismaMock.inboundMessage.findFirst.mockResolvedValue(null);
    await expect(
      mailboxDraftStatus(source, "org1", "u1")
    ).resolves.toMatchObject({ state: "UNAVAILABLE" });
    expect(
      prismaMock.inboundMessage.findFirst.mock.calls[0][0]?.where
    ).toMatchObject({ inboxAccountId: { in: [] } });
  });
  it("rejects another change after the displayed review", async () => {
    prismaMock.inboundMessage.findFirst.mockResolvedValue({
      ...message,
      remoteDraftVersion: "v3",
    } as never);
    await expect(
      emailDraftService.reviewSource("d1", "u1", {
        expectedRevision: 4,
        expectedVersion: "v2",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled();
  });
  it.each([{ revision: 5 }, { completedSendId: "job1" }])(
    "rejects a competing change to the private copy %j",
    async (change) => {
      prismaMock.emailDraft.findFirst.mockResolvedValue({
        ...draft,
        ...change,
      } as never);
      await expect(
        emailDraftService.reviewSource("d1", "u1", {
          expectedRevision: 4,
          expectedVersion: "v1",
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    }
  );
  it.each([{ contentImportPending: true }, { bodyStatus: "UNAVAILABLE" }])(
    "keeps incomplete text and files out of review %j",
    async (change) => {
      prismaMock.inboundMessage.findFirst.mockResolvedValue({
        ...message,
        ...change,
      } as never);
      await expect(
        mailboxDraftStatus(source, "org1", "u1")
      ).resolves.toMatchObject({ state: "LOADING", reviewed: false });
      await expect(
        emailDraftService.reviewSource("d1", "u1", {
          expectedRevision: 4,
          expectedVersion: "v1",
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    }
  );
  it("rejects a deletion that wins while review is in flight", async () => {
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      emailDraftService.reviewSource("d1", "u1", {
        expectedRevision: 4,
        expectedVersion: "v1",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("requires an owned private copy and valid server provenance", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue(null);
    await expect(
      emailDraftService.sourceStatus("d1", "u1")
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      emailDraftService.reviewSource("d1", "u1", {
        expectedRevision: 4,
        expectedVersion: "v1",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(() => mailboxDraftSource({ messageId: "m1" })).toThrow();
  });
});
