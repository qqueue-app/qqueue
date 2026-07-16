import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { HttpError } from "../../lib/http-error.js";

const storageMock = {
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn()
};

vi.mock("../../lib/storage.js", () => ({ storage: storageMock }));

const { imageService, publicImageUrl } = await import("./service.js");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("body")
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("body")]);
const GIF = Buffer.from("GIF89a and pixels");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
  Buffer.from("body")
]);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org_1",
    userId: "user_1",
    filename: "banner.png",
    contentType: "image/png",
    size: PNG.length,
    buffer: PNG,
    ...overrides
  };
}

function createdAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "img_1",
    publicId: "abc123",
    filename: "banner.png",
    contentType: "image/png",
    size: PNG.length,
    storageKey: "org/org_1/images/uuid-banner.png",
    ...overrides
  };
}

describe("imageService.upload", () => {
  beforeEach(() => {
    storageMock.putObject.mockReset().mockResolvedValue(undefined);
    storageMock.getObject.mockReset();
  });

  it("stores the blob under an images prefix and returns a public URL", async () => {
    prismaMock.imageAsset.create.mockResolvedValue(createdAsset() as never);

    const result = await imageService.upload(baseInput());

    const putArg = storageMock.putObject.mock.calls[0][0];
    expect(putArg.key).toMatch(/^org\/org_1\/images\/.+-banner\.png$/);
    expect(putArg.contentType).toBe("image/png");

    const data = prismaMock.imageAsset.create.mock.calls[0][0].data;
    expect(data.organizationId).toBe("org_1");
    expect(data.createdByUserId).toBe("user_1");
    expect(data.storageKey).toBe(putArg.key);
    expect(result).toEqual({
      id: "img_1",
      url: "http://localhost:4000/api/v1/images/abc123",
      filename: "banner.png",
      contentType: "image/png",
      size: PNG.length
    });
  });

  it("addresses the public URL by an unguessable token, not the row id", async () => {
    prismaMock.imageAsset.create.mockResolvedValue(createdAsset() as never);
    await imageService.upload(baseInput());

    const { publicId } = prismaMock.imageAsset.create.mock.calls[0][0].data;
    expect(publicId).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    ["image/jpeg", JPEG, "shot.jpg"],
    ["image/gif", GIF, "loop.gif"],
    ["image/webp", WEBP, "hero.webp"]
  ])("accepts %s", async (contentType, buffer, filename) => {
    prismaMock.imageAsset.create.mockResolvedValue(
      createdAsset({ contentType, filename }) as never
    );

    const result = await imageService.upload(
      baseInput({ contentType, buffer, filename, size: buffer.length })
    );

    expect(result.contentType).toBe(contentType);
    expect(storageMock.putObject).toHaveBeenCalledTimes(1);
  });

  it("rejects an SVG, which could carry script on our own origin", async () => {
    await expect(
      imageService.upload(
        baseInput({
          contentType: "image/svg+xml",
          filename: "logo.svg",
          buffer: Buffer.from("<svg onload=\"alert(1)\"></svg>")
        })
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "unsupported_image_type" });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("rejects a payload whose bytes contradict its declared image type", async () => {
    await expect(
      imageService.upload(
        baseInput({ buffer: Buffer.from("<html><script>alert(1)</script>") })
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "unsupported_image_type" });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("rejects bytes of an allowed type that isn't the declared one", async () => {
    await expect(
      imageService.upload(baseInput({ contentType: "image/gif", buffer: PNG }))
    ).rejects.toBeInstanceOf(HttpError);
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("tolerates a charset parameter on the declared type", async () => {
    prismaMock.imageAsset.create.mockResolvedValue(createdAsset() as never);
    await expect(
      imageService.upload(baseInput({ contentType: "image/png; charset=binary" }))
    ).resolves.toMatchObject({ contentType: "image/png" });
  });

  it("rejects an empty file without touching storage", async () => {
    await expect(
      imageService.upload(baseInput({ size: 0 }))
    ).rejects.toBeInstanceOf(HttpError);
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit", async () => {
    await expect(
      imageService.upload(baseInput({ size: 10_485_761 }))
    ).rejects.toMatchObject({ statusCode: 400, code: "image_too_large" });
    expect(storageMock.putObject).not.toHaveBeenCalled();
  });

  it("strips path components from the stored filename", async () => {
    prismaMock.imageAsset.create.mockResolvedValue(createdAsset() as never);
    await imageService.upload(baseInput({ filename: "../../etc/passwd.png" }));

    const { filename } = prismaMock.imageAsset.create.mock.calls[0][0].data;
    expect(filename).toBe("passwd.png");
    expect(storageMock.putObject.mock.calls[0][0].key).not.toContain("..");
  });
});

describe("imageService.serve", () => {
  beforeEach(() => {
    storageMock.getObject.mockReset().mockResolvedValue(PNG);
  });

  it("returns the asset and its blob for a known publicId", async () => {
    prismaMock.imageAsset.findUnique.mockResolvedValue(createdAsset() as never);

    const { asset, body } = await imageService.serve("abc123");

    expect(prismaMock.imageAsset.findUnique).toHaveBeenCalledWith({
      where: { publicId: "abc123" }
    });
    expect(asset.contentType).toBe("image/png");
    expect(body).toBe(PNG);
  });

  it("404s an unknown publicId without reaching storage", async () => {
    prismaMock.imageAsset.findUnique.mockResolvedValue(null as never);

    await expect(imageService.serve("nope")).rejects.toMatchObject({
      statusCode: 404
    });
    expect(storageMock.getObject).not.toHaveBeenCalled();
  });
});

describe("publicImageUrl", () => {
  it("builds an absolute URL a mail client can resolve", () => {
    expect(publicImageUrl("tok")).toBe("http://localhost:4000/api/v1/images/tok");
  });
});
