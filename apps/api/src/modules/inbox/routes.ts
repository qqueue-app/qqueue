import { Router } from "express";
import { requireInboxEnabled } from "../../middleware/require-feature.js";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { inboxController } from "./controller.js";

export const inboxRouter = Router();

inboxRouter.use(requireInboxEnabled);

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
inboxRouter.patch(
  "/messages/:id/assignment",
  requireOrgMembership,
  inboxController.assignMessage
);
inboxRouter.get(
  "/messages/:id/notes",
  requireOrgMembership,
  inboxController.listNotes
);
inboxRouter.post(
  "/messages/:id/notes",
  requireOrgMembership,
  inboxController.createNote
);
inboxRouter.post(
  "/messages/:id/reply",
  requireOrgMembership,
  inboxController.replyToMessage
);
