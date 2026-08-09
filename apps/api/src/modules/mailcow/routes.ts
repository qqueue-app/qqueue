import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { mailcowController } from "./controller.js";

// Mailbox provisioning is an org-admin surface over instance-level Mailcow
// config. Status, the mailbox list and every per-mailbox action are
// OWNER/ADMIN (the service further limits an ADMIN to granted domains);
// domain-grant management is OWNER-only, because the grant is exactly what
// separates an ADMIN's reach from an OWNER's. When the instance has no
// Mailcow configured, status says so and the mutating routes answer 404.
//
// `:email` is the mailbox address, URL-encoded. Per-mailbox routes are
// declared before the domain-grant ones so that no address can be mistaken
// for a grant id.
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
  "/mailboxes",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  mailcowController.listMailboxes
);
mailcowRouter.post(
  "/mailboxes/:email/adopt",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  mailcowController.adoptMailbox
);
mailcowRouter.post(
  "/mailboxes/:email/password",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  mailcowController.resetMailboxPassword
);
mailcowRouter.patch(
  "/mailboxes/:email",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  mailcowController.setMailboxActive
);
mailcowRouter.delete(
  "/mailboxes/:email",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  mailcowController.deleteMailbox
);
// Domain management is OWNER-only, a step above the mailbox routes above.
// Mailcow domains are instance-global — creating or deleting one changes the
// shared mail server for everyone on it, and claiming one decides which org
// reaches it at all. `:domain` is the domain name, URL-encoded.
mailcowRouter.get(
  "/domains",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.listDomains
);
mailcowRouter.post(
  "/domains",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.createDomain
);
mailcowRouter.get(
  "/domains/:domain/dns",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.domainDns
);
mailcowRouter.post(
  "/domains/:domain/dkim",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.generateDomainDkim
);
mailcowRouter.post(
  "/domains/:domain/claim",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.claimDomain
);
mailcowRouter.patch(
  "/domains/:domain",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.updateDomain
);
mailcowRouter.delete(
  "/domains/:domain",
  requireOrgMembership,
  requireOrgRole("OWNER"),
  mailcowController.deleteDomain
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
