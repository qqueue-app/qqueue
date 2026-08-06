import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { smtpConnectionController } from "./controller.js";

export const smtpConnectionRouter = Router();

// Sending accounts are the org's outbound identity and hold its SMTP
// credentials: any member may see and send from them, but only OWNER/ADMIN may
// add, alter, or remove them. The /:id writes carry no org id in the request,
// so their role check lives in the service (same 403), next to the ownership
// lookup.
smtpConnectionRouter.get("/", requireOrgMembership, smtpConnectionController.list);
// The composer's picker: connections this user may actually send as. Must be
// registered before /:id so "sendable" isn't read as an id.
smtpConnectionRouter.get(
  "/sendable",
  requireOrgMembership,
  smtpConnectionController.listSendable
);
smtpConnectionRouter.post(
  "/",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  smtpConnectionController.create
);
smtpConnectionRouter.get("/:id", smtpConnectionController.get);
smtpConnectionRouter.put("/:id", smtpConnectionController.update);
smtpConnectionRouter.delete("/:id", smtpConnectionController.delete);
// On-demand credential test; changes nothing, so membership-level like reads.
smtpConnectionRouter.post("/:id/verify", smtpConnectionController.verify);
// Send-as grants (OWNER/ADMIN, enforced in the service like other writes).
smtpConnectionRouter.get("/:id/grants", smtpConnectionController.listGrants);
smtpConnectionRouter.post("/:id/grants", smtpConnectionController.addGrant);
smtpConnectionRouter.delete(
  "/:id/grants/:userId",
  smtpConnectionController.removeGrant
);
