import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { contactListController } from "./controller.js";

export const contactListRouter = Router();

contactListRouter.get("/", requireOrgMembership, contactListController.list);
contactListRouter.post("/", requireOrgMembership, contactListController.create);
contactListRouter.get("/:id", contactListController.get);
contactListRouter.put("/:id", contactListController.update);
contactListRouter.delete("/:id", contactListController.delete);
