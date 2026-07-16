import type { Request, Response } from "express";
import { HttpError } from "../../lib/http-error.js";
import { imageService } from "./service.js";

export const imageController = {
  async upload(req: Request, res: Response) {
    if (!req.file) {
      throw new HttpError(400, "A file is required", "validation_error");
    }

    const image = await imageService.upload({
      // organizationId is verified and pinned by requireOrgMembership.
      organizationId: req.organizationId!,
      userId: req.userId!,
      filename: req.file.originalname,
      contentType: req.file.mimetype || "application/octet-stream",
      size: req.file.size,
      buffer: req.file.buffer
    });

    res.status(201).json({ data: image });
  },

  /**
   * Public, unauthenticated read — recipients' mail clients have no session.
   * The headers matter as much as the bytes: the content type is one we sniffed
   * at upload, `nosniff` stops a browser re-interpreting it as markup, and the
   * CSP neutralizes anything embedded should a payload ever slip past upload
   * validation. Blobs are immutable (fresh key per upload), so cache hard.
   */
  async serve(req: Request, res: Response) {
    const { asset, body } = await imageService.serve(String(req.params.publicId));

    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Content-Length", String(body.length));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(body);
  }
};
