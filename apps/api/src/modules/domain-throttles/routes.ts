import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { domainThrottleController } from "./controller.js";

export const domainThrottleRouter = Router();

domainThrottleRouter.get(
  "/",
  requireOrgMembership,
  domainThrottleController.list
);
// Changing caps is an OWNER/ADMIN operation (affects deliverability for all).
domainThrottleRouter.put(
  "/",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  domainThrottleController.upsert
);
domainThrottleRouter.delete("/:id", domainThrottleController.remove);
