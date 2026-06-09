import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { templateController } from "./controller.js";

export const templateRouter = Router();

templateRouter.get("/", requireOrgMembership, templateController.list);
templateRouter.post("/", requireOrgMembership, templateController.create);
templateRouter.get("/:id", templateController.get);
templateRouter.put("/:id", templateController.update);
templateRouter.delete("/:id", templateController.delete);
