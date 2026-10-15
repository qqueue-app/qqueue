import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { emailDraftService } from "./service.js";

describe("emailDraftService", () => {
  it("lists drafts scoped to the org and user", () => {
    prismaMock.emailDraft.findMany.mockResolvedValue([] as never);
    emailDraftService.list("org_1", "user_1");
    expect(prismaMock.emailDraft.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        createdByUserId: "user_1",
        completedSendId: null,
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
    });
  });

  it("gets a draft scoped to the owning user, including its attachments", () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      revision: 1,
    } as never);
    emailDraftService.get("d1", "user_1");
    expect(prismaMock.emailDraft.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", createdByUserId: "user_1", deletedAt: null },
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
            cid: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });

  it("creates a draft and records the authoring user", () => {
    prismaMock.emailDraft.create.mockResolvedValue({
      id: "d1",
      revision: 1,
    } as never);
    emailDraftService.create(
      {
        organizationId: "org_1",
        subject: "Hi",
        to: ["a@x.com"],
        listIds: ["list_1"],
      },
      "user_1"
    );
    const data = prismaMock.emailDraft.create.mock.calls[0][0].data;
    expect(data.organizationId).toBe("org_1");
    expect(data.createdByUserId).toBe("user_1");
    expect(data.subject).toBe("Hi");
    expect(data.to).toEqual(["a@x.com"]);
    expect(data.listIds).toEqual(["list_1"]);
    // Defaults applied for omitted arrays.
    expect(data.cc).toEqual([]);
    expect(data.bcc).toEqual([]);
  });

  it("updates an owned draft", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      revision: 1,
    } as never);
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.emailDraft.findFirstOrThrow.mockResolvedValue({
      id: "d1",
      revision: 2,
    } as never);
    await emailDraftService.update("d1", "user_1", {
      subject: "Updated",
      expectedRevision: 1,
      mutationId: "m1",
    });
    expect(prismaMock.emailDraft.updateMany).toHaveBeenCalledWith({
      where: {
        id: "d1",
        createdByUserId: "user_1",
        revision: 1,
        completedSendId: null,
        deletedAt: null,
      },
      data: expect.objectContaining({
        subject: "Updated",
        revision: { increment: 1 },
        lastMutationId: "m1",
      }),
    });
  });

  // Phase 4: a draft naming an ungranted sending account is rejected at save.
  it("blocks a MEMBER from saving a draft with an ungranted connection", async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue(null);

    await expect(
      emailDraftService.create(
        { organizationId: "org_1", smtpConnectionId: "s1" },
        "user_1"
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "send_as_denied" });
    expect(prismaMock.emailDraft.create).not.toHaveBeenCalled();
  });

  it("lets a MEMBER with a grant pick the connection on update", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      organizationId: "org_1",
      revision: 1,
    } as never);
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER",
    } as never);
    prismaMock.smtpConnectionGrant.findUnique.mockResolvedValue({
      id: "g1",
    } as never);
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.emailDraft.findFirstOrThrow.mockResolvedValue({
      id: "d1",
      revision: 2,
    } as never);

    await emailDraftService.update("d1", "user_1", {
      smtpConnectionId: "s1",
      expectedRevision: 1,
      mutationId: "m1",
    });
    expect(prismaMock.emailDraft.updateMany).toHaveBeenCalled();
  });

  it("throws 404 when updating a draft the user does not own", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue(null);
    await expect(
      emailDraftService.update("d1", "user_1", {
        subject: "x",
        expectedRevision: 1,
        mutationId: "m1",
      })
    ).rejects.toThrow(HttpError);
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled();
  });

  it("deletes an owned draft", async () => {
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 1 } as never);
    await emailDraftService.delete("d1", "user_1");
    expect(prismaMock.emailDraft.updateMany).toHaveBeenCalledWith({
      where: {
        id: "d1",
        createdByUserId: "user_1",
        completedSendId: null,
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date), revision: { increment: 1 } },
    });
  });

  it("throws 404 when deleting a draft the user does not own", async () => {
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 0 } as never);
    await expect(emailDraftService.delete("d1", "user_1")).rejects.toThrow(
      HttpError
    );
  });
});

describe("draft conflict and replay safety", () => {
  it("reuses the original create after a lost response and rejects changed content", async () => {
    const input = {
      organizationId: "org_1",
      clientId: "device-1",
      subject: "Original",
    };
    prismaMock.emailDraft.create.mockImplementation(
      async (args) => ({ id: "d1", ...args.data }) as never
    );
    const original = await emailDraftService.create(input, "user_1");
    prismaMock.emailDraft.create.mockRejectedValue({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    prismaMock.emailDraft.findFirst.mockResolvedValue(original as never);
    await expect(emailDraftService.create(input, "user_1")).resolves.toEqual(
      original
    );
    await expect(
      emailDraftService.create({ ...input, subject: "Changed" }, "user_1")
    ).rejects.toMatchObject({ statusCode: 409, code: "draft_conflict" });
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      ...original,
      revision: 2,
    } as never);
    await expect(
      emailDraftService.create(input, "user_1")
    ).rejects.toMatchObject({ statusCode: 409, code: "draft_conflict" });
    expect(prismaMock.emailDraft.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        createdByUserId: "user_1",
        clientId: "device-1",
      },
    });
  });
  it("refuses a stale device revision without writing over newer content", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      revision: 4,
      organizationId: "org_1",
    } as never);
    await expect(
      emailDraftService.update("d1", "user_1", {
        subject: "Stale",
        expectedRevision: 3,
        mutationId: "edit-stale",
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "draft_conflict" });
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled();
  });
  it("acknowledges an unchanged lost-response mutation once", async () => {
    const saved = { id: "d1", revision: 4, lastMutationId: "edit-1" };
    prismaMock.emailDraft.findFirst.mockResolvedValue(saved as never);
    await expect(
      emailDraftService.update("d1", "user_1", {
        expectedRevision: 3,
        mutationId: "edit-1",
      })
    ).resolves.toEqual(saved);
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled();
  });
  it("keeps an accepted draft as a tombstone and rejects further edits", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      revision: 4,
      completedSendId: "job1",
    } as never);
    await expect(
      emailDraftService.update("d1", "user_1", {
        expectedRevision: 4,
        mutationId: "edit-2",
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "draft_completed" });
    expect(prismaMock.emailDraft.updateMany).not.toHaveBeenCalled();
  });
  it("reports a conditional-write conflict rather than pretending a save succeeded", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({
      id: "d1",
      revision: 1,
    } as never);
    prismaMock.emailDraft.updateMany.mockResolvedValue({ count: 0 } as never);
    await expect(
      emailDraftService.update("d1", "user_1", {
        expectedRevision: 1,
        mutationId: "edit-3",
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
