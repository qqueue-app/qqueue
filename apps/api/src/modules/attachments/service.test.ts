import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";

const storageMock = {
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn()
};

vi.mock("../../lib/storage.js", () => ({ storage: storageMock }));

const { attachmentService } = await import("./service.js");

function baseInput() {
  return {
    organizationId: "org_1",
    userId: "user_1",
    filename: "report.pdf",
    contentType: "application/pdf",
    size: 1024,
    buffer: Buffer.from("hello")
  };
}

describe("attachmentService.upload", () => {
  beforeEach(() => {
    storageMock.putObject.mockReset().mockResolvedValue(undefined);
    storageMock.getObject.mockReset();
    storageMock.deleteObject.mockReset().mockResolvedValue(undefined);
  });

  it("stores the blob and records metadata, returning a compact shape", async () => {
    prismaMock.emailAttachment.create.mockResolvedValue({
      id: "att_1",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 1024
    } as never);

    const result = await attachmentService.upload(baseInput());

    expect(storageMock.putObject).toHaveBeenCalledTimes(1);
    const putArg = storageMock.putObject.mock.calls[0][0];
    expect(putArg.key).toMatch(/^org\/org_1\/.+-report\.pdf$/);
    expect(putArg.contentType).toBe("application/pdf");

    const data = prismaMock.emailAttachment.create.mock.calls[0][0].data;
    expect(data.organizationId).toBe("org_1");
    expect(data.createdByUserId).toBe("user_1");
    expect(data.storageKey).toBe(putArg.key);
    expect(result).toEqual({
      id: "att_1",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 1024
    });
  });

  it("rejects an empty file without touching storage", async () => {
    await expect(
      attachmentService.upload({ ...baseInput(), size: 0 })
    ).rejects.toThrow(HttpError);
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("rejects a file over the configured size ceiling", async () => {
    await expect(
      attachmentService.upload({ ...baseInput(), size: 10_485_761 })
    ).rejects.toThrow(/exceeds/);
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("links to a draft only when it belongs to the user and org", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue({ id: "d1" } as never);
    prismaMock.emailAttachment.create.mockResolvedValue({
      id: "att_1",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 1024
    } as never);

    await attachmentService.upload({ ...baseInput(), emailDraftId: "d1" });

    expect(prismaMock.emailDraft.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", organizationId: "org_1", createdByUserId: "user_1" },
      select: { id: true }
    });
    expect(
      prismaMock.emailAttachment.create.mock.calls[0][0].data.emailDraftId
    ).toBe("d1");
  });

  it("ignores a draft id the user does not own", async () => {
    prismaMock.emailDraft.findFirst.mockResolvedValue(null);
    prismaMock.emailAttachment.create.mockResolvedValue({
      id: "att_1",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 1024
    } as never);

    await attachmentService.upload({ ...baseInput(), emailDraftId: "nope" });

    expect(
      prismaMock.emailAttachment.create.mock.calls[0][0].data.emailDraftId
    ).toBeUndefined();
  });

  it("sanitizes path traversal out of the stored filename", async () => {
    prismaMock.emailAttachment.create.mockResolvedValue({
      id: "att_1",
      filename: "passwd",
      contentType: "text/plain",
      size: 10
    } as never);

    await attachmentService.upload({
      ...baseInput(),
      filename: "../../etc/passwd",
      contentType: "text/plain",
      size: 10
    });

    const data = prismaMock.emailAttachment.create.mock.calls[0][0].data;
    expect(data.filename).toBe("passwd");
    expect(data.storageKey).not.toContain("..");
  });
});

describe("attachmentService.download", () => {
  beforeEach(() => {
    storageMock.getObject.mockReset();
  });

  it("returns metadata and blob for an owned attachment", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue({
      id: "att_1",
      storageKey: "org/org_1/k-report.pdf",
      filename: "report.pdf",
      contentType: "application/pdf"
    } as never);
    storageMock.getObject.mockResolvedValue(Buffer.from("data"));

    const { attachment, body } = await attachmentService.download(
      "att_1",
      "user_1"
    );

    expect(prismaMock.emailAttachment.findFirst).toHaveBeenCalledWith({
      where: { id: "att_1", createdByUserId: "user_1" }
    });
    expect(storageMock.getObject).toHaveBeenCalledWith("org/org_1/k-report.pdf");
    expect(attachment.id).toBe("att_1");
    expect(body.toString()).toBe("data");
  });

  it("throws 404 for an attachment the user does not own", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue(null);
    await expect(
      attachmentService.download("att_1", "user_1")
    ).rejects.toThrow(HttpError);
    expect(storageMock.getObject).not.toHaveBeenCalled();
  });
});

describe("attachmentService.delete", () => {
  beforeEach(() => {
    storageMock.deleteObject.mockReset().mockResolvedValue(undefined);
  });

  it("removes the blob and the metadata row", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue({
      id: "att_1",
      storageKey: "org/org_1/k-report.pdf"
    } as never);
    prismaMock.emailAttachment.delete.mockResolvedValue({} as never);

    await attachmentService.delete("att_1", "user_1");

    expect(storageMock.deleteObject).toHaveBeenCalledWith(
      "org/org_1/k-report.pdf"
    );
    expect(prismaMock.emailAttachment.delete).toHaveBeenCalledWith({
      where: { id: "att_1" }
    });
  });

  it("still clears the row when blob deletion fails", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue({
      id: "att_1",
      storageKey: "k"
    } as never);
    storageMock.deleteObject.mockRejectedValue(new Error("s3 down"));
    prismaMock.emailAttachment.delete.mockResolvedValue({} as never);

    await attachmentService.delete("att_1", "user_1");

    expect(prismaMock.emailAttachment.delete).toHaveBeenCalled();
  });

  it("throws 404 when the attachment is not found", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue(null);
    await expect(attachmentService.delete("att_1", "user_1")).rejects.toThrow(
      HttpError
    );
  });
});

describe("attachmentService.linkToJob", () => {
  beforeEach(() => {
    prismaMock.emailAttachment.updateMany.mockReset();
  });

  it("does nothing when there are no attachment ids", async () => {
    await attachmentService.linkToJob(undefined, "org_1", "job_1");
    await attachmentService.linkToJob([], "org_1", "job_1");

    expect(prismaMock.emailAttachment.updateMany).not.toHaveBeenCalled();
  });

  it("claims unlinked attachments for the job", async () => {
    prismaMock.emailAttachment.updateMany.mockResolvedValue({
      count: 2
    } as never);

    await attachmentService.linkToJob(["a1", "a2"], "org_1", "job_1");

    expect(prismaMock.emailAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1", "a2"] }, organizationId: "org_1", emailJobId: null },
      data: { emailJobId: "job_1" }
    });
  });

  // Previously these were skipped silently, producing an email with fewer
  // attachments than the caller asked for and reporting success.
  it("throws when an id cannot be claimed (already sent, unknown, or other org)", async () => {
    prismaMock.emailAttachment.updateMany.mockResolvedValue({
      count: 1
    } as never);

    await expect(
      attachmentService.linkToJob(["a1", "a2"], "org_1", "job_1")
    ).rejects.toThrow(HttpError);
  });

  it("counts duplicate ids once so a repeated id is not a false mismatch", async () => {
    prismaMock.emailAttachment.updateMany.mockResolvedValue({
      count: 1
    } as never);

    await expect(
      attachmentService.linkToJob(["a1", "a1"], "org_1", "job_1")
    ).resolves.toBeUndefined();

    expect(
      prismaMock.emailAttachment.updateMany.mock.calls[0][0].where.id
    ).toEqual({ in: ["a1"] });
  });
});
