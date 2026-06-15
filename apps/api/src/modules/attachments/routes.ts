import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer, { MulterError } from "multer";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { attachmentController } from "./controller.js";

// Buffer uploads in memory (they go straight to object storage) and cap the
// size at the configured ceiling so a large upload can't exhaust memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.ATTACHMENT_MAX_BYTES }
});

// Run multer first so the multipart text fields (organizationId, emailDraftId)
// are parsed onto req.body before requireOrgMembership reads them. Translate
// multer's size error into a clean 400.
function uploadSingle(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(
          new HttpError(
            400,
            `Attachment exceeds the ${env.ATTACHMENT_MAX_BYTES}-byte limit`,
            "attachment_too_large"
          )
        );
        return;
      }
      next(new HttpError(400, error.message, "validation_error"));
      return;
    }
    next(error as Error | undefined);
  });
}

export const attachmentRouter = Router();

attachmentRouter.post(
  "/",
  uploadSingle,
  requireOrgMembership,
  attachmentController.upload
);
// Resource-addressed routes scope by the authenticated user in the service.
attachmentRouter.get("/:id", attachmentController.download);
attachmentRouter.delete("/:id", attachmentController.delete);
