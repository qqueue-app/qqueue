import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { sentController } from "./controller.js";

export const sentRouter = Router();

// Read-only, and any member may read it: the archive is the org's own mail log.
sentRouter.get("/", requireOrgMembership, sentController.list);
