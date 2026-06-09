import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { smtpConnectionController } from "./controller.js";

export const smtpConnectionRouter = Router();

smtpConnectionRouter.get("/", requireOrgMembership, smtpConnectionController.list);
smtpConnectionRouter.post("/", requireOrgMembership, smtpConnectionController.create);
smtpConnectionRouter.get("/:id", smtpConnectionController.get);
smtpConnectionRouter.put("/:id", smtpConnectionController.update);
smtpConnectionRouter.delete("/:id", smtpConnectionController.delete);
smtpConnectionRouter.post("/:id/test", smtpConnectionController.test);
