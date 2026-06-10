import { Router } from "express";
import { requireOrgMembership } from "../../middleware/require-org.js";
import { campaignController } from "./controller.js";

export const campaignRouter = Router();

campaignRouter.get("/", requireOrgMembership, campaignController.list);
campaignRouter.post("/", requireOrgMembership, campaignController.create);
campaignRouter.get("/:id", campaignController.get);
campaignRouter.put("/:id", campaignController.update);
campaignRouter.delete("/:id", campaignController.delete);
campaignRouter.post("/:id/duplicate", campaignController.duplicate);
campaignRouter.post("/:id/send", campaignController.sendNow);
campaignRouter.post("/:id/schedule", campaignController.schedule);
campaignRouter.post("/:id/recurrence", campaignController.setRecurrence);
campaignRouter.post("/:id/pause", campaignController.pause);
campaignRouter.post("/:id/resume", campaignController.resume);
