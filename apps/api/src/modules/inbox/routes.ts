import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { inboxController } from "./controller.js";

export const inboxRouter = Router();

inboxRouter.get(
  "/accounts",
  requireOrgMembership,
  inboxController.listAccounts
);
inboxRouter.post(
  "/accounts",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  inboxController.createAccount
);
inboxRouter.patch(
  "/accounts/:id",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  inboxController.updateAccount
);
inboxRouter.delete(
  "/accounts/:id",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  inboxController.deleteAccount
);

inboxRouter.get(
  "/messages",
  requireOrgMembership,
  inboxController.listMessages
);
inboxRouter.post(
  "/messages",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  inboxController.storeInboundMessage
);
inboxRouter.patch(
  "/messages/:id/read",
  requireOrgMembership,
  inboxController.markRead
);
inboxRouter.post(
  "/messages/:id/reply",
  requireOrgMembership,
  inboxController.replyToMessage
);
// Authenticated download of a file that arrived on a received message. Private
// by design — the public /images/:publicId route exists for the opposite case
// (recipients' mail clients), and inbound files must never be reachable there.
inboxRouter.get(
  "/messages/:id/attachments/:attachmentId",
  requireOrgMembership,
  inboxController.downloadAttachment
);
