import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";
import { emailDraftService } from "./service.js";

describe("emailDraftService", () => {
  it("lists drafts scoped to the org and user", () => {
    prismaMock.emailDraft.findMany.mockResolvedValue([] as never);
    emailDraftService.list("org_1", "user_1");
    expect(prismaMock.emailDraft.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", createdByUserId: "user_1" },
      orderBy: { updatedAt: "desc" }
    });
  });

  it("gets a draft scoped to the owning user, including its attachments", () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({ id: "d1" } as never);
    emailDraftService.get("d1", "user_1");
    expect(prismaMock.emailDraft.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", createdByUserId: "user_1" },
      include: {
        attachments: {
          select: { id: true, filename: true, contentType: true, size: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });
  });

  it("creates a draft and records the authoring user", () => {
    prismaMock.emailDraft.create.mockResolvedValue({ id: "d1" } as never);
    emailDraftService.create(
      {
        organizationId: "org_1",
        subject: "Hi",
        to: ["a@x.com"],
        listIds: ["list_1"]
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
    prismaMock.emailDraft.findFirst.mockResolvedValue({ id: "d1" } as never);
    prismaMock.emailDraft.update.mockResolvedValue({ id: "d1" } as never);
    await emailDraftService.update("d1", "user_1", { subject: "Updated" });
    expect(prismaMock.emailDraft.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ subject: "Updated" })
    });
  });

  it("throws 404 when updating a draft the user does not own", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue(null);
    await expect(
      emailDraftService.update("d1", "user_1", { subject: "x" })
    ).rejects.toThrow(HttpError);
    expect(prismaMock.emailDraft.update).not.toHaveBeenCalled();
  });

  it("deletes an owned draft", async () => {
    prismaMock.emailDraft.deleteMany.mockResolvedValue({ count: 1 } as never);
    await emailDraftService.delete("d1", "user_1");
    expect(prismaMock.emailDraft.deleteMany).toHaveBeenCalledWith({
      where: { id: "d1", createdByUserId: "user_1" }
    });
  });

  it("throws 404 when deleting a draft the user does not own", async () => {
    prismaMock.emailDraft.deleteMany.mockResolvedValue({ count: 0 } as never);
    await expect(emailDraftService.delete("d1", "user_1")).rejects.toThrow(
      HttpError
    );
  });
});
