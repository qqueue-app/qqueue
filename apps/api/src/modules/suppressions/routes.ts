import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { suppressionController } from "./controller.js";

export const suppressionRouter = Router();

suppressionRouter.get("/", requireOrgMembership, suppressionController.list);
suppressionRouter.post("/", requireOrgMembership, suppressionController.create);
suppressionRouter.delete("/:id", suppressionController.remove);
