import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { outboxController } from "./controller.js";

export const outboxRouter = Router();

// Both routes carry organizationId (query for the read, body for the cancel),
// so membership is verified by the middleware rather than in the service.
outboxRouter.get("/", requireOrgMembership, outboxController.list);
outboxRouter.post("/:id/cancel", requireOrgMembership, outboxController.cancel);
