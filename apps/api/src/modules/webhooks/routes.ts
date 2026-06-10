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
webhookEndpointRouter.put("/:id", webhookEndpointController.update);
webhookEndpointRouter.delete("/:id", webhookEndpointController.delete);
