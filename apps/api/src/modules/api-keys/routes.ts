import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { apiKeyController } from "./controller.js";

export const apiKeyRouter = Router();

apiKeyRouter.get("/", requireOrgMembership, apiKeyController.list);
apiKeyRouter.post("/", requireOrgMembership, apiKeyController.create);
apiKeyRouter.post("/:id/revoke", apiKeyController.revoke);
