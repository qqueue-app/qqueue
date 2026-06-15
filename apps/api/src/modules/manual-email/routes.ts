import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { manualEmailController } from "./controller.js";

export const manualEmailRouter = Router();

// Manual composer sends always run as the authenticated dashboard user (the
// router is mounted after requireAuth); requireOrgMembership pins + verifies the
// organization from the request body.
manualEmailRouter.post("/send", requireOrgMembership, manualEmailController.send);
manualEmailRouter.post(
  "/preview",
  requireOrgMembership,
  manualEmailController.preview
);
// Per-recipient delivery status for a sent manual email (org from query).
manualEmailRouter.get(
  "/:emailJobId/status",
  requireOrgMembership,
  manualEmailController.status
);
