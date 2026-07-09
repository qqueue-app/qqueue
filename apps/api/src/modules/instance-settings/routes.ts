import { Router } from "express";
import { requireInstanceAdmin } from "../../middleware/require-instance-admin.js";
import { instanceSettingsController } from "./controller.js";

export const instanceSettingsRouter = Router();

// Mounted under requireAuth in v1.ts; every route additionally requires the
// instance-admin flag.
instanceSettingsRouter.use(requireInstanceAdmin);

instanceSettingsRouter.get("/", instanceSettingsController.get);
instanceSettingsRouter.patch("/", instanceSettingsController.update);
instanceSettingsRouter.get("/env-status", instanceSettingsController.envStatus);
