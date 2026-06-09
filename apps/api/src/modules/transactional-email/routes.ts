import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { transactionalEmailController } from "./controller.js";

export const transactionalEmailRouter = Router();

transactionalEmailRouter.post(
  "/send",
  requireOrgMembership,
  transactionalEmailController.send
);
