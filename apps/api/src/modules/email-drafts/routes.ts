import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { emailDraftController } from "./controller.js";

export const emailDraftRouter = Router();

emailDraftRouter.get("/", requireOrgMembership, emailDraftController.list);
emailDraftRouter.post("/", requireOrgMembership, emailDraftController.create);
// Resource-addressed routes scope by the authenticated user in the service.
emailDraftRouter.get("/:id", emailDraftController.get);
emailDraftRouter.put("/:id", emailDraftController.update);
emailDraftRouter.delete("/:id", emailDraftController.delete);
