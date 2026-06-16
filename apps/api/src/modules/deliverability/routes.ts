import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { deliverabilityController } from "./controller.js";

export const deliverabilityRouter = Router();

// Deliverability is an operations view, restricted to OWNER/ADMIN.
deliverabilityRouter.use(requireOrgMembership, requireOrgRole("OWNER", "ADMIN"));

deliverabilityRouter.get("/overview", deliverabilityController.overview);
deliverabilityRouter.get("/domains", deliverabilityController.domains);
deliverabilityRouter.get("/alerts", deliverabilityController.alerts);
