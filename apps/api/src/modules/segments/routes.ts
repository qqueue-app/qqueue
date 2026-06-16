import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { segmentController } from "./controller.js";

export const segmentRouter = Router();

segmentRouter.get("/", requireOrgMembership, segmentController.list);
segmentRouter.post("/", requireOrgMembership, segmentController.create);
// Live preview of a rule tree (count + sample) without saving a segment.
segmentRouter.post(
  "/preview",
  requireOrgMembership,
  segmentController.preview
);
// Addressed-by-id routes scope by org membership in the service layer.
segmentRouter.get("/:id", segmentController.get);
segmentRouter.put("/:id", segmentController.update);
segmentRouter.delete("/:id", segmentController.remove);
