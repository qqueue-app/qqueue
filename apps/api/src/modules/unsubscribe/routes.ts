import { Router } from "express";
import { rateLimit } from "../../middleware/rate-limit.js";
import { unsubscribeController } from "./controller.js";

// Public, unauthenticated: hit by recipients' mail clients (GET renders a
// confirmation page, POST performs the RFC 8058 one-click unsubscribe). The
// signed token in the query string is the authorization; the rate limit keeps
// the endpoint from being a free token-guessing or nuisance target.
export const unsubscribeRouter = Router();

const unsubscribeLimit = rateLimit({
  keyPrefix: "unsubscribe",
  windowSeconds: 15 * 60,
  max: 60,
  key: (req) => req.ip || "unknown"
});

unsubscribeRouter.get("/unsubscribe", unsubscribeLimit, unsubscribeController.get);
unsubscribeRouter.post("/unsubscribe", unsubscribeLimit, unsubscribeController.post);
