import { Router } from "express";
import { organizationController } from "./controller.js";

export const organizationRouter = Router();

organizationRouter.get("/", organizationController.list);
organizationRouter.post("/", organizationController.create);
organizationRouter.get("/:id/members", organizationController.listMembers);
organizationRouter.patch(
  "/:id/members/:userId",
  organizationController.updateMemberRole
);
organizationRouter.delete(
  "/:id/members/:userId",
  organizationController.removeMember
);
// Branding is org-scoped configuration addressed by :id, so the role check
// lives in the service (assertOrgRole) like the rest of this module rather than
// in `requireOrgRole`, which reads the org from the query/body.
organizationRouter.get("/:id/branding", organizationController.getBranding);
organizationRouter.put("/:id/branding", organizationController.updateBranding);
organizationRouter.get("/:id", organizationController.get);
organizationRouter.put("/:id", organizationController.update);
organizationRouter.delete("/:id", organizationController.delete);
