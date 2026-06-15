import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer, { MulterError } from "multer";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { contactController } from "./controller.js";

// Buffer the CSV upload in memory and cap its size. Reuses the attachment size
// ceiling rather than introducing another env var.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.ATTACHMENT_MAX_BYTES }
});

// Multer runs first so the multipart text field (organizationId) lands on
// req.body before requireOrgMembership reads it. A missing file is allowed
// because the CSV can also be sent as a JSON `csv` field.
function uploadCsv(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(
          new HttpError(400, "CSV exceeds the upload size limit", "validation_error")
        );
        return;
      }
      next(new HttpError(400, error.message, "validation_error"));
      return;
    }
    next(error as Error | undefined);
  });
}

export const contactRouter = Router();

contactRouter.get("/", requireOrgMembership, contactController.list);
contactRouter.post("/", requireOrgMembership, contactController.create);
// Bulk CSV import/export. Registered before "/:id" so "export" isn't captured
// as a contact id.
contactRouter.post(
  "/import",
  uploadCsv,
  requireOrgMembership,
  contactController.import
);
contactRouter.get("/export", requireOrgMembership, contactController.export);
// Tag-driven segment preview (count + sample of matching contacts).
contactRouter.post(
  "/segment/preview",
  requireOrgMembership,
  contactController.previewSegment
);
contactRouter.get("/:id", contactController.get);
contactRouter.get("/:id/activity", contactController.activity);
contactRouter.put("/:id", contactController.update);
contactRouter.delete("/:id", contactController.delete);
