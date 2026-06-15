import type { Request, Response } from "express";
import { HttpError } from "../../lib/http-error.js";
import { attachmentService } from "./service.js";

export const attachmentController = {
  async upload(req: Request, res: Response) {
    if (!req.file) {
      throw new HttpError(400, "A file is required", "validation_error");
    }

    const emailDraftId =
      typeof req.body?.emailDraftId === "string" && req.body.emailDraftId
        ? req.body.emailDraftId
        : undefined;

    const attachment = await attachmentService.upload({
      // organizationId is verified and pinned by requireOrgMembership.
      organizationId: req.organizationId!,
      userId: req.userId!,
      filename: req.file.originalname,
      contentType: req.file.mimetype || "application/octet-stream",
      size: req.file.size,
      buffer: req.file.buffer,
      emailDraftId
    });

    res.status(201).json({ data: attachment });
  },

  async download(req: Request, res: Response) {
    const { attachment, body } = await attachmentService.download(
      String(req.params.id),
      req.userId!
    );

    res.setHeader("Content-Type", attachment.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachment.filename.replace(/"/g, "")}"`
    );
    res.send(body);
  },

  async delete(req: Request, res: Response) {
    await attachmentService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
