import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { contactListController } from "./controller.js";

export const contactListRouter = Router();

contactListRouter.get("/", requireOrgMembership, contactListController.list);
contactListRouter.post("/", requireOrgMembership, contactListController.create);
// Materialize a tag-driven segment into a new list. Before "/:id".
contactListRouter.post(
  "/from-segment",
  requireOrgMembership,
  contactListController.createFromSegment
);
contactListRouter.get("/:id", contactListController.get);
contactListRouter.put("/:id", contactListController.update);
contactListRouter.delete("/:id", contactListController.delete);
