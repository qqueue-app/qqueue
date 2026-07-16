import { randomBytes, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage.js";

export interface UploadImageInput {
  organizationId: string;
  userId: string;
  filename: string;
  contentType: string;
  size: number;
  buffer: Buffer;
}

export interface ImageAssetMetadata {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Raster formats only. SVG is deliberately excluded: it can carry script, and
 * these blobs are served from our own origin, so an SVG upload would be a
 * stored-XSS vector rather than just an image.
 */
const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp"
] as const;

type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/**
 * The declared Content-Type comes from the browser and is trivially forged, so
 * every upload must also *look* like the format it claims. This is what stops
 * an HTML/script payload being stored and later served under an image type.
 */
function sniff(buffer: Buffer): AllowedContentType | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header === "GIF87a" || header === "GIF89a") {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[^\w.\- ]+/g, "_").trim();
  const cleaned = base.length > 0 ? base : "image";
  return cleaned.slice(0, 200);
}

/**
 * Absolute and built from APP_URL, because the consumer is a recipient's mail
 * client on the open internet — the same base the tracking pixel/click links
 * use. A relative URL would never resolve in an inbox.
 */
export function publicImageUrl(publicId: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}/api/v1/images/${publicId}`;
}

export const imageService = {
  /**
   * Store an image for embedding in email HTML: blob to object storage,
   * metadata to Postgres, and a public URL back. Unlike attachments, the
   * resulting URL needs no authentication to read — see `serve`.
   */
  async upload(input: UploadImageInput): Promise<ImageAssetMetadata> {
    if (input.size <= 0) {
      throw new HttpError(400, "Image is empty", "validation_error");
    }
    if (input.size > env.ATTACHMENT_MAX_BYTES) {
      throw new HttpError(
        400,
        `Image exceeds the ${env.ATTACHMENT_MAX_BYTES}-byte limit`,
        "image_too_large"
      );
    }

    const declared = input.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_CONTENT_TYPES.includes(declared as AllowedContentType)) {
      throw new HttpError(
        400,
        "Images must be PNG, JPEG, GIF, or WebP",
        "unsupported_image_type"
      );
    }

    // Trust the bytes, not the header — and store the sniffed type, since that
    // is what we will serve back.
    const actual = sniff(input.buffer);
    if (!actual || actual !== declared) {
      throw new HttpError(
        400,
        "File content does not match its image type",
        "unsupported_image_type"
      );
    }

    const filename = sanitizeFilename(input.filename);
    const storageKey = `org/${input.organizationId}/images/${randomUUID()}-${filename}`;

    await storage.putObject({
      key: storageKey,
      body: input.buffer,
      contentType: actual
    });

    const asset = await prisma.imageAsset.create({
      data: {
        publicId: randomBytes(16).toString("hex"),
        organizationId: input.organizationId,
        filename,
        contentType: actual,
        size: input.size,
        storageKey,
        createdByUserId: input.userId
      }
    });

    return {
      id: asset.id,
      url: publicImageUrl(asset.publicId),
      filename: asset.filename,
      contentType: asset.contentType,
      size: asset.size
    };
  },

  /**
   * Read an image for public delivery. Intentionally unauthenticated: the
   * caller is a recipient's mail client, which has no session. Authorization
   * rests entirely on the unguessable `publicId`.
   */
  async serve(publicId: string) {
    const asset = await prisma.imageAsset.findUnique({ where: { publicId } });
    if (!asset) {
      throw new HttpError(404, "Image not found", "not_found");
    }
    const body = await storage.getObject(asset.storageKey);
    return { asset, body };
  }
};
