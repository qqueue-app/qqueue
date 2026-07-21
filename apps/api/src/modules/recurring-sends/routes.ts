import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { recurringSendController } from "./controller.js";

export const recurringSendRouter = Router();

recurringSendRouter.get("/", requireOrgMembership, recurringSendController.list);
recurringSendRouter.post(
  "/",
  requireOrgMembership,
  recurringSendController.create
);
// The remaining routes scope by organization membership inside the service.
recurringSendRouter.get("/:id", recurringSendController.get);
recurringSendRouter.put("/:id", recurringSendController.update);
recurringSendRouter.post("/:id/pause", recurringSendController.pause);
recurringSendRouter.post("/:id/resume", recurringSendController.resume);
recurringSendRouter.delete("/:id", recurringSendController.delete);
