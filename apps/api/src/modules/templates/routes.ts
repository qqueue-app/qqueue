import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { templateController } from "./controller.js";

export const templateRouter = Router();

templateRouter.get("/", requireOrgMembership, templateController.list);
templateRouter.post("/", requireOrgMembership, templateController.create);
// Preview renders subject/body with sample data. Membership is enforced in the
// service (org scoped by userId), so no requireOrgMembership query guard here.
templateRouter.post("/preview", templateController.preview);
templateRouter.get("/:id", templateController.get);
templateRouter.put("/:id", templateController.update);
templateRouter.delete("/:id", templateController.delete);
templateRouter.post("/:id/clone", templateController.clone);
templateRouter.post("/:id/test", templateController.testSend);
