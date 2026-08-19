import { beforeEach, describe, expect, it, vi } from "vitest";
import { INLINE_ATTACHMENT_MAX_BYTES } from "@qqueue/shared";
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
  /** A stored part, uploaded by `user_2` and sent with job `job_1`. */
  function sentAttachment(overrides: Record<string, unknown> = {}) {
    return {
      id: "att_1",
      organizationId: "org_1",
      createdByUserId: "user_2",
      emailJobId: "job_1",
      storageKey: "org/org_1/k-report.pdf",
      filename: "report.pdf",
      contentType: "application/pdf",
      ...overrides
    };
  }

  beforeEach(() => {
    storageMock.getObject.mockReset();
    prismaMock.emailJob.findFirst.mockReset();
    prismaMock.organizationMember.findUnique.mockReset();
  });

  it("returns metadata and blob for an attachment the user uploaded", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue(
      sentAttachment({ createdByUserId: "user_1" }) as never
    );
    storageMock.getObject.mockResolvedValue(Buffer.from("data"));

    const { attachment, body } = await attachmentService.download(
      "att_1",
      "user_1"
    );

    // The uploader needs no message to inherit access from, so nothing else is
    // consulted — this is the path a draft's attachments take.
    expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();
    expect(storageMock.getObject).toHaveBeenCalledWith("org/org_1/k-report.pdf");
    expect(attachment.id).toBe("att_1");
    expect(body.toString()).toBe("data");
  });

  it("throws 404 when the attachment does not exist", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue(null);
    await expect(
      attachmentService.download("att_1", "user_1")
    ).rejects.toThrow(HttpError);
    expect(storageMock.getObject).not.toHaveBeenCalled();
  });

  it("lets someone who may read the message open what it carried", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue(
      sentAttachment() as never
    );
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "OWNER"
    } as never);
    prismaMock.emailJob.findFirst.mockResolvedValue({ id: "job_1" } as never);
    storageMock.getObject.mockResolvedValue(Buffer.from("data"));

    const { body } = await attachmentService.download("att_1", "user_1");

    // Unrestricted, so the job is looked up with no scope clause bolted on.
    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job_1", organizationId: "org_1" },
      select: { id: true }
    });
    expect(body.toString()).toBe("data");
  });

  it("scopes a MEMBER to the mailboxes they hold", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue(
      sentAttachment() as never
    );
    prismaMock.organizationMember.findUnique.mockResolvedValue({
      role: "MEMBER"
    } as never);
    prismaMock.smtpConnectionGrant.findMany.mockResolvedValue([
      { smtpConnectionId: "smtp_1" }
    ] as never);
    prismaMock.inboxAccountGrant.findMany.mockResolvedValue([] as never);
    // The job doesn't match that scope.
    prismaMock.emailJob.findFirst.mockResolvedValue(null as never);

    await expect(
      attachmentService.download("att_1", "user_1")
    ).rejects.toThrow(HttpError);

    expect(prismaMock.emailJob.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job_1",
        organizationId: "org_1",
        AND: [
          {
            OR: [
              { smtpConnectionId: { in: ["smtp_1"] } },
              { createdByUserId: "user_1" }
            ]
          }
        ]
      },
      select: { id: true }
    });
    expect(storageMock.getObject).not.toHaveBeenCalled();
  });

  it("refuses an unsent attachment belonging to somebody else", async () => {
    // A draft's file has no message to inherit access from, so the uploader
    // check is its only door — this is what keeps drafts private.
    prismaMock.emailAttachment.findFirst.mockResolvedValue(
      sentAttachment({ emailJobId: null }) as never
    );

    await expect(
      attachmentService.download("att_1", "user_1")
    ).rejects.toThrow(HttpError);
    expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();
    expect(storageMock.getObject).not.toHaveBeenCalled();
  });

  it("reads as not-found to somebody outside the organization", async () => {
    prismaMock.emailAttachment.findFirst.mockResolvedValue(
      sentAttachment() as never
    );
    // No membership: 404 rather than the 403 resolveMailboxAccess would throw,
    // so the id doesn't confirm that something exists here.
    prismaMock.organizationMember.findUnique.mockResolvedValue(null as never);

    await expect(
      attachmentService.download("att_1", "user_1")
    ).rejects.toThrow(HttpError);
    expect(prismaMock.emailJob.findFirst).not.toHaveBeenCalled();
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

describe("attachmentService.copyToJob", () => {
  it("does nothing when there are no attachment ids", async () => {
    await attachmentService.copyToJob(undefined, "org_1", "job_2");
    await attachmentService.copyToJob([], "org_1", "job_2");

    expect(prismaMock.emailAttachment.createMany).not.toHaveBeenCalled();
  });

  it("clones metadata rows onto the sibling job, sharing the stored blob", async () => {
    prismaMock.emailAttachment.findMany.mockResolvedValue([
      {
        id: "a1",
        organizationId: "org_1",
        emailJobId: "job_1",
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 3,
        storageKey: "org/org_1/k-report.pdf",
        cid: "qr",
        createdByUserId: "user_1"
      }
    ] as never);
    prismaMock.emailAttachment.createMany.mockResolvedValue({
      count: 1
    } as never);

    await attachmentService.copyToJob(["a1"], "org_1", "job_2");

    expect(prismaMock.emailAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: "org_1",
          emailJobId: "job_2",
          filename: "report.pdf",
          contentType: "application/pdf",
          size: 3,
          storageKey: "org/org_1/k-report.pdf",
          cid: "qr",
          createdByUserId: "user_1"
        }
      ]
    });
  });

  it("throws when an id is unknown or belongs to another org", async () => {
    prismaMock.emailAttachment.findMany.mockResolvedValue([] as never);

    await expect(
      attachmentService.copyToJob(["a1"], "org_1", "job_2")
    ).rejects.toThrow(HttpError);
    expect(prismaMock.emailAttachment.createMany).not.toHaveBeenCalled();
  });
});

describe("attachmentService.createInlineForJob", () => {
  beforeEach(() => {
    storageMock.putObject.mockReset().mockResolvedValue(undefined);
    prismaMock.emailAttachment.create.mockReset();
  });

  it("does nothing when there are no inline attachments", async () => {
    await attachmentService.createInlineForJob(undefined, "org_1", "job_1");
    await attachmentService.createInlineForJob([], "org_1", "job_1");

    expect(storageMock.putObject).not.toHaveBeenCalled();
    expect(prismaMock.emailAttachment.create).not.toHaveBeenCalled();
  });

  it("stores the decoded blob and a row carrying the cid, linked to the job", async () => {
    prismaMock.emailAttachment.create.mockResolvedValue({ id: "att_1" } as never);

    await attachmentService.createInlineForJob(
      [
        {
          filename: "qr.png",
          contentBase64: Buffer.from("png-bytes").toString("base64"),
          contentType: "image/png",
          cid: "ticket-qr"
        }
      ],
      "org_1",
      "job_1",
      null
    );

    const putArg = storageMock.putObject.mock.calls[0][0];
    expect(putArg.key).toMatch(/^org\/org_1\/.+-qr\.png$/);
    expect(putArg.body).toEqual(Buffer.from("png-bytes"));
    expect(putArg.contentType).toBe("image/png");

    const data = prismaMock.emailAttachment.create.mock.calls[0][0].data;
    expect(data.emailJobId).toBe("job_1");
    expect(data.cid).toBe("ticket-qr");
    expect(data.size).toBe(Buffer.from("png-bytes").length);
    expect(data.storageKey).toBe(putArg.key);
    // API-key sends have no acting user; the column must stay unset, not "null".
    expect(data.createdByUserId).toBeUndefined();
  });

  it("defaults the content type and leaves cid unset when omitted", async () => {
    prismaMock.emailAttachment.create.mockResolvedValue({ id: "att_1" } as never);

    await attachmentService.createInlineForJob(
      [
        {
          filename: "notes.txt",
          contentBase64: Buffer.from("hello").toString("base64")
        }
      ],
      "org_1",
      "job_1",
      "user_1"
    );

    expect(storageMock.putObject.mock.calls[0][0].contentType).toBe(
      "application/octet-stream"
    );
    const data = prismaMock.emailAttachment.create.mock.calls[0][0].data;
    expect(data.contentType).toBe("application/octet-stream");
    expect(data.cid).toBeUndefined();
    expect(data.createdByUserId).toBe("user_1");
  });

  it("rejects an oversized attachment before touching storage", async () => {
    const oversized = Buffer.alloc(INLINE_ATTACHMENT_MAX_BYTES + 1).toString(
      "base64"
    );

    await expect(
      attachmentService.createInlineForJob(
        [{ filename: "big.bin", contentBase64: oversized }],
        "org_1",
        "job_1"
      )
    ).rejects.toThrow(HttpError);
    expect(storageMock.putObject).not.toHaveBeenCalled();
    expect(prismaMock.emailAttachment.create).not.toHaveBeenCalled();
  });
});
