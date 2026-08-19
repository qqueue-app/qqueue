import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { sentController } from "./controller.js";

export const sentRouter = Router();

// Read-only, and any member may read it: the archive is the org's own mail log.
sentRouter.get("/", requireOrgMembership, sentController.list);
// One message in full, body included. Carries organizationId as a query
// parameter like the list, so membership is settled by the middleware and the
// service only has the per-mailbox rule left to apply.
sentRouter.get("/:id", requireOrgMembership, sentController.get);
