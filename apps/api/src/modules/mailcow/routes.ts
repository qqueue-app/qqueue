import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { mailcowController } from "./controller.js";

// Mailbox provisioning is an org-admin surface over instance-level Mailcow
// config. Status, the mailbox list and every per-mailbox action are OWNER/ADMIN
// — the service further limits an ADMIN to granted domains, and limits the org
// as a whole to domains an instance administrator assigned it. When the
// instance has no Mailcow configured, status says so and the mutating routes
// answer 404.
//
// Domain management and domain grants are deliberately *not* here. A Mailcow
// domain is instance-global — creating or deleting one changes the mail server
// every org shares — so gating it on org OWNER gated it on nothing, given that
// anyone may create an org and become its OWNER. Those routes live under
// `/instance-admin`, behind `User.isInstanceAdmin`.
//
// `:email` is the mailbox address, URL-encoded.
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
