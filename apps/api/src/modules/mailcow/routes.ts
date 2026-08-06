import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { mailcowController } from "./controller.js";

// Mailbox provisioning is an org-admin surface over instance-level Mailcow
// config; both routes are OWNER/ADMIN. When the instance has no Mailcow
// configured, status says so and provision answers 404.
export const mailcowRouter = Router();

mailcowRouter.get(
  "/status",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  mailcowController.status
);
mailcowRouter.post(
  "/provision",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  mailcowController.provision
);
