import { Router } from "express";
import { trackingController } from "./controller.js";

// Public, unauthenticated: these are hit by recipients' mail clients and by
// external ESP webhook callers, none of which carry a session token.
export const trackingRouter = Router();

trackingRouter.get("/track/open/:token", trackingController.open);
trackingRouter.get("/track/click/:token", trackingController.click);
trackingRouter.post("/webhooks/email-events", trackingController.webhook);
