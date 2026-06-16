import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { suppressionController } from "./controller.js";

export const suppressionRouter = Router();

suppressionRouter.get("/", requireOrgMembership, suppressionController.list);
suppressionRouter.post("/", requireOrgMembership, suppressionController.create);
// Auto-suppression policy (effective values for reads; OWNER/ADMIN to change).
suppressionRouter.get(
  "/policy",
  requireOrgMembership,
  suppressionController.getPolicy
);
suppressionRouter.put(
  "/policy",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  suppressionController.updatePolicy
);
suppressionRouter.delete("/:id", suppressionController.remove);
