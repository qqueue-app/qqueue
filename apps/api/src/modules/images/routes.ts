import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer, { MulterError } from "multer";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { imageController } from "./controller.js";

// Buffer in memory (the blob goes straight to object storage) and cap the size
// so a large upload can't exhaust memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.ATTACHMENT_MAX_BYTES }
});

// Multer runs first so the multipart `organizationId` text field is parsed onto
// req.body before requireOrgMembership reads it. Multer's size error becomes a
// clean 400.
function uploadSingle(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(
          new HttpError(
            400,
            `Image exceeds the ${env.ATTACHMENT_MAX_BYTES}-byte limit`,
            "image_too_large"
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

/**
 * Public, unauthenticated: mail clients fetch embedded images with no session
 * token. Mounted outside requireAuth — authorization is the unguessable
 * publicId in the URL.
 */
export const imagePublicRouter = Router();

imagePublicRouter.get("/images/:publicId", imageController.serve);

/** Authenticated, org-scoped upload from the editor. */
export const imageRouter = Router();

imageRouter.post("/", uploadSingle, requireOrgMembership, imageController.upload);
