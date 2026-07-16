import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract without re-testing service behaviour (storage, scoping).
vi.mock("./service.js", () => ({
  attachmentService: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() }
}));

const { attachmentController } = await import("./controller.js");
const { attachmentService } = await import("./service.js");
const { HttpError } = await import("../../lib/http-error.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

const file = {
  originalname: "invoice.pdf",
  mimetype: "application/pdf",
  size: 2048,
  buffer: Buffer.from("pdf-bytes")
} as Express.Multer.File;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("attachmentController.upload", () => {
  it("stores the file for the pinned org/user and responds 201", async () => {
    const attachment = {
      id: "att_1",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: 2048
    };
    vi.mocked(attachmentService.upload).mockResolvedValue(attachment);
    const res = mockRes();

    await attachmentController.upload(
      {
        file,
        body: {},
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      res
    );

    expect(attachmentService.upload).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "usr_1",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: 2048,
      buffer: file.buffer,
      emailDraftId: undefined
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: attachment });
  });

  it("links the upload to a draft when the body carries one", async () => {
    vi.mocked(attachmentService.upload).mockResolvedValue({} as never);

    await attachmentController.upload(
      {
        file,
        body: { emailDraftId: "draft_1" },
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      mockRes()
    );

    expect(attachmentService.upload).toHaveBeenCalledWith(
      expect.objectContaining({ emailDraftId: "draft_1" })
    );
  });

  // Multipart fields arrive untyped, so anything not a non-empty string is dropped.
  it.each([
    ["an empty string", ""],
    ["a non-string", 42],
    ["an array", ["draft_1"]]
  ])("ignores %s emailDraftId", async (_label, emailDraftId) => {
    vi.mocked(attachmentService.upload).mockResolvedValue({} as never);

    await attachmentController.upload(
      {
        file,
        body: { emailDraftId },
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      mockRes()
    );

    expect(attachmentService.upload).toHaveBeenCalledWith(
      expect.objectContaining({ emailDraftId: undefined })
    );
  });

  it("ignores a missing body entirely", async () => {
    vi.mocked(attachmentService.upload).mockResolvedValue({} as never);

    await attachmentController.upload(
      { file, organizationId: "org_1", userId: "usr_1" } as unknown as Request,
      mockRes()
    );

    expect(attachmentService.upload).toHaveBeenCalledWith(
      expect.objectContaining({ emailDraftId: undefined })
    );
  });

  it("falls back to a generic content type when the client sends none", async () => {
    vi.mocked(attachmentService.upload).mockResolvedValue({} as never);

    await attachmentController.upload(
      {
        file: { ...file, mimetype: "" },
        body: {},
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      mockRes()
    );

    expect(attachmentService.upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "application/octet-stream" })
    );
  });

  it("rejects a request with no file", async () => {
    await expect(
      attachmentController.upload(
        { body: {}, organizationId: "org_1", userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "validation_error",
      message: "A file is required"
    });
    expect(attachmentService.upload).not.toHaveBeenCalled();
  });
});

describe("attachmentController.download", () => {
  it("scopes the download to the session user and sends the blob", async () => {
    const body = Buffer.from("pdf-bytes");
    vi.mocked(attachmentService.download).mockResolvedValue({
      attachment: { contentType: "application/pdf", filename: "invoice.pdf" },
      body
    } as never);
    const res = mockRes();

    await attachmentController.download(
      { params: { id: "att_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    // Attachments are private: the user id is always part of the lookup, unlike
    // the public publicId-addressed image path.
    expect(attachmentService.download).toHaveBeenCalledWith("att_1", "usr_1");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/pdf"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="invoice.pdf"'
    );
    expect(res.send).toHaveBeenCalledWith(body);
  });

  // A quote in the filename would otherwise break out of the header's quoting.
  it("strips quotes from the filename in the Content-Disposition header", async () => {
    vi.mocked(attachmentService.download).mockResolvedValue({
      attachment: {
        contentType: "text/plain",
        filename: 'we"ird".txt'
      },
      body: Buffer.from("x")
    } as never);
    const res = mockRes();

    await attachmentController.download(
      { params: { id: "att_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="weird.txt"'
    );
  });

  it("propagates a not-found from the service", async () => {
    vi.mocked(attachmentService.download).mockRejectedValue(
      new HttpError(404, "Attachment not found", "not_found")
    );
    const res = mockRes();

    await expect(
      attachmentController.download(
        { params: { id: "nope" }, userId: "usr_1" } as unknown as Request,
        res
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe("attachmentController.delete", () => {
  it("deletes for the session user and responds 204 with no body", async () => {
    vi.mocked(attachmentService.delete).mockResolvedValue(undefined);
    const res = mockRes();

    await attachmentController.delete(
      { params: { id: "att_1" }, userId: "usr_1" } as unknown as Request,
      res
    );

    expect(attachmentService.delete).toHaveBeenCalledWith("att_1", "usr_1");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith();
  });

  it("propagates a not-found from the service", async () => {
    vi.mocked(attachmentService.delete).mockRejectedValue(
      new HttpError(404, "Attachment not found", "not_found")
    );

    await expect(
      attachmentController.delete(
        { params: { id: "nope" }, userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
