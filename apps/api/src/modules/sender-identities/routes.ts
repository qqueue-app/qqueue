import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { senderIdentityController } from "./controller.js";

export const senderIdentityRouter = Router();

senderIdentityRouter.get("/", requireOrgMembership, senderIdentityController.list);
senderIdentityRouter.post("/", requireOrgMembership, senderIdentityController.create);
senderIdentityRouter.get("/:id", senderIdentityController.get);
senderIdentityRouter.put("/:id", senderIdentityController.update);
senderIdentityRouter.delete("/:id", senderIdentityController.delete);
