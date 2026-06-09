import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { dashboardController } from "./controller.js";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", requireOrgMembership, dashboardController.summary);
