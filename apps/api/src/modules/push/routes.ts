import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { pushController } from "./controller.js";

/**
 * Public push routes, mounted above `requireAuth`.
 *
 * Rotation is the whole reason this router exists: a browser can replace a
 * subscription at any time, usually with no tab open, and the service worker
 * that hears about it cannot read the access token out of localStorage. The old
 * endpoint is the credential instead — unguessable, issued by the push service
 * to one client. Same pattern as unsubscribe links and public image reads.
 */
export const pushPublicRouter = Router();

pushPublicRouter.post("/push/subscriptions/rotate", pushController.rotate);

export const pushRouter = Router();

// Registrations belong to a *person*, not an organization: one device receives
// mail alerts for every org its owner has turned them on for. Nothing here
// carries an organizationId except the notification preference, which is the
// only route that needs a membership check.
pushRouter.get("/public-key", pushController.publicKey);
pushRouter.get("/subscriptions", pushController.list);
pushRouter.post("/subscriptions", pushController.subscribe);
pushRouter.delete("/subscriptions", pushController.unsubscribe);

pushRouter.get(
  "/preferences",
  requireOrgMembership,
  pushController.getPreference
);
pushRouter.put(
  "/preferences",
  requireOrgMembership,
  pushController.updatePreference
);
