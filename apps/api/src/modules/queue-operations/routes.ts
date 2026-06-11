import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { queueOperationsController } from "./controller.js";

export const queueOperationsRouter = Router();

// Queue operations expose background infrastructure across the whole instance,
// so they are restricted to organization owners/admins. The caller proves their
// role by passing organizationId (query for reads, body for the retry write).
queueOperationsRouter.use(
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN")
);

queueOperationsRouter.get("/", queueOperationsController.summary);
queueOperationsRouter.post(
  "/:queueName/jobs/:jobId/retry",
  queueOperationsController.retry
);
