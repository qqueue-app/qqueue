import { Router } from "express";
import { organizationController } from "./controller.js";

export const organizationRouter = Router();

organizationRouter.get("/", organizationController.list);
organizationRouter.post("/", organizationController.create);
organizationRouter.get("/:id/members", organizationController.listMembers);
organizationRouter.get("/:id", organizationController.get);
organizationRouter.put("/:id", organizationController.update);
organizationRouter.delete("/:id", organizationController.delete);
