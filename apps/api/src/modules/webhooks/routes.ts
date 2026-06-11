import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { webhookEndpointController } from "./controller.js";

export const webhookEndpointRouter = Router();

webhookEndpointRouter.get(
  "/",
  requireOrgMembership,
  webhookEndpointController.list
);
webhookEndpointRouter.post(
  "/",
  requireOrgMembership,
  webhookEndpointController.create
);
webhookEndpointRouter.get(
  "/:id/deliveries",
  webhookEndpointController.listDeliveries
);
webhookEndpointRouter.post(
  "/deliveries/:deliveryId/retry",
  webhookEndpointController.retryDelivery
);
webhookEndpointRouter.put("/:id", webhookEndpointController.update);
webhookEndpointRouter.delete("/:id", webhookEndpointController.delete);
