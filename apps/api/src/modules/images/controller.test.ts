import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The controller layer is a thin adapter: validate input, delegate to the
// service, shape the HTTP response. Stub the service so these tests pin the
// adapter's contract without re-testing service behaviour (sniffing, storage).
vi.mock("./service.js", () => ({
  imageService: { upload: vi.fn(), serve: vi.fn() }
}));

const { imageController } = await import("./controller.js");
const { imageService } = await import("./service.js");
const { HttpError } = await import("../../lib/http-error.js");

function mockRes() {
  const res = {} as Response;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

const pngFile = {
  originalname: "logo.png",
  mimetype: "image/png",
  size: 1024,
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47])
} as Express.Multer.File;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("imageController.upload", () => {
  it("stores the file for the pinned org/user and responds 201", async () => {
    const image = {
      id: "img_1",
      url: "http://localhost:4000/api/v1/images/abc123",
      filename: "logo.png",
      contentType: "image/png",
      size: 1024
    };
    vi.mocked(imageService.upload).mockResolvedValue(image);
    const res = mockRes();

    await imageController.upload(
      {
        file: pngFile,
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      res
    );

    expect(imageService.upload).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "usr_1",
      filename: "logo.png",
      contentType: "image/png",
      size: 1024,
      buffer: pngFile.buffer
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: image });
  });

  it("falls back to a generic content type when the client sends none", async () => {
    vi.mocked(imageService.upload).mockResolvedValue({} as never);

    await imageController.upload(
      {
        file: { ...pngFile, mimetype: "" },
        organizationId: "org_1",
        userId: "usr_1"
      } as unknown as Request,
      mockRes()
    );

    // The service rejects anything that isn't an allowed raster type, so an
    // undeclared upload must reach it as a type it will refuse — not as an image.
    expect(imageService.upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "application/octet-stream" })
    );
  });

  it("rejects a request with no file", async () => {
    await expect(
      imageController.upload(
        { organizationId: "org_1", userId: "usr_1" } as unknown as Request,
        mockRes()
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "validation_error",
      message: "A file is required"
    });
    expect(imageService.upload).not.toHaveBeenCalled();
  });

  // SVG rejection lives in the service (it sniffs the bytes); the controller's
  // job is only to hand the declared type through unmodified for it to judge.
  it("passes an SVG upload through to the service for rejection", async () => {
    vi.mocked(imageService.upload).mockRejectedValue(
      new HttpError(
        400,
        "Images must be PNG, JPEG, GIF, or WebP",
        "unsupported_image_type"
      )
    );

    await expect(
      imageController.upload(
        {
          file: {
            ...pngFile,
            originalname: "x.svg",
            mimetype: "image/svg+xml",
            buffer: Buffer.from("<svg onload=alert(1)>")
          },
          organizationId: "org_1",
          userId: "usr_1"
        } as unknown as Request,
        mockRes()
      )
    ).rejects.toThrow("Images must be PNG, JPEG, GIF, or WebP");

    expect(imageService.upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/svg+xml" })
    );
  });
});

describe("imageController.serve", () => {
  it("serves the blob addressed only by publicId, with hardened headers", async () => {
    const body = Buffer.from("png-bytes");
    vi.mocked(imageService.serve).mockResolvedValue({
      asset: { contentType: "image/png" },
      body
    } as never);
    const res = mockRes();

    // Deliberately no session on the request: a recipient's mail client has
    // none, so `serve` must not depend on req.userId/req.organizationId.
    await imageController.serve(
      { params: { publicId: "abc123" } } as unknown as Request,
      res
    );

    expect(imageService.serve).toHaveBeenCalledWith("abc123");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Length",
      String(body.length)
    );
    expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", "inline");
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      "default-src 'none'; sandbox"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );
    expect(res.send).toHaveBeenCalledWith(body);
  });

  it("propagates a not-found from the service", async () => {
    vi.mocked(imageService.serve).mockRejectedValue(
      new HttpError(404, "Image not found", "not_found")
    );
    const res = mockRes();

    await expect(
      imageController.serve(
        { params: { publicId: "missing" } } as unknown as Request,
        res
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(res.send).not.toHaveBeenCalled();
  });
});
