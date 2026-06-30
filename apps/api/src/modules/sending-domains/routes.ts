import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { sendingDomainController } from "./controller.js";

export const sendingDomainRouter = Router();

sendingDomainRouter.get("/", requireOrgMembership, sendingDomainController.list);
sendingDomainRouter.post("/", requireOrgMembership, sendingDomainController.create);
sendingDomainRouter.get("/:id", sendingDomainController.get);
sendingDomainRouter.put("/:id", sendingDomainController.update);
sendingDomainRouter.delete("/:id", sendingDomainController.delete);
