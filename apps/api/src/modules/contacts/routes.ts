import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { contactController } from "./controller.js";

export const contactRouter = Router();

contactRouter.get("/", requireOrgMembership, contactController.list);
contactRouter.post("/", requireOrgMembership, contactController.create);
contactRouter.get("/:id", contactController.get);
contactRouter.put("/:id", contactController.update);
contactRouter.delete("/:id", contactController.delete);
