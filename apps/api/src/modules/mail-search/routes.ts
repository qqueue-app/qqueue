import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { mailSearchController } from "./controller.js";
export const mailSearchRouter = Router();
mailSearchRouter.get("/", requireOrgMembership, mailSearchController.search);
mailSearchRouter.get(
  "/mailboxes",
  requireOrgMembership,
  mailSearchController.mailboxes
);

mailSearchRouter.get(
  "/outgoing/:id",
  requireOrgMembership,
  mailSearchController.outgoing
);
