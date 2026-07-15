import { Router } from "express";
import { rateLimit } from "../../middleware/rate-limit.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { setupController } from "./controller.js";

export const setupRouter = Router();

const statusLimit = rateLimit({
  keyPrefix: "setup-status",
  windowSeconds: 60,
  max: 60,
  key: (req) => req.ip || "unknown"
});

// Public: the web app probes this before anyone is signed in to decide
// whether to route into the first-run wizard.
setupRouter.get("/status", statusLimit, setupController.status);

// Finishing the wizard requires the signed-in instance admin.
setupRouter.post("/complete", requireAuth, setupController.complete);
