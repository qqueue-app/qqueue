import { Router } from "express";
import { rateLimit } from "../../middleware/rate-limit.js";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { invitationController } from "./controller.js";

// Public routes (no access token): preview + accept an invitation via its
// emailed token. Mounted before `requireAuth` in the v1 router. Rate-limited by
// IP because `accept` can create an account.
export const invitationPublicRouter = Router();

const invitePublicLimit = rateLimit({
  keyPrefix: "invite-accept",
  windowSeconds: 15 * 60,
  max: 30,
  key: (req) => req.ip || "unknown"
});

invitationPublicRouter.get(
  "/invitations/lookup",
  invitePublicLimit,
  invitationController.lookup
);
invitationPublicRouter.post(
  "/invitations/accept",
  invitePublicLimit,
  invitationController.accept
);

// Authenticated routes: manage invitations for an organization. Gated to
// OWNER/ADMIN — `requireOrgMembership` pins the org from query/body, then
// `requireOrgRole` enforces the role. Revoke is addressed by id, so the service
// resolves the org and checks the role there instead.
export const invitationRouter = Router();

invitationRouter.get(
  "/",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  invitationController.list
);
invitationRouter.post(
  "/",
  requireOrgMembership,
  requireOrgRole("OWNER", "ADMIN"),
  invitationController.create
);
invitationRouter.delete("/:id", invitationController.revoke);
