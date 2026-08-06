import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { pushController } from "./controller.js";

export const pushRouter = Router();

// Push registrations belong to a *person*, not an organization: the same device
// receives mail alerts for whichever org the user is in. Only subscribe carries
// an organizationId (to scope which org's mail may notify this device), so only
// it needs the membership check.
pushRouter.get("/public-key", pushController.publicKey);
pushRouter.get("/subscriptions", pushController.list);
pushRouter.post("/subscriptions", requireOrgMembership, pushController.subscribe);
pushRouter.delete("/subscriptions", pushController.unsubscribe);
