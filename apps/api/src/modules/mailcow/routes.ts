import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { mailcowController } from "./controller.js";

// Mailbox provisioning is an org-admin surface over instance-level Mailcow
// config. Status/provision are OWNER/ADMIN (the service further limits an
// ADMIN to granted domains); domain-grant management is OWNER-only, because
// the grant is exactly what separates an ADMIN's reach from an OWNER's.
// When the instance has no Mailcow configured, status says so and the
// mutating routes answer 404.
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
mailcowRouter.get(
  "/domain-grants",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.listDomainGrants
);
mailcowRouter.post(
  "/domain-grants",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.addDomainGrant
);
mailcowRouter.delete(
  "/domain-grants/:id",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.removeDomainGrant
);
