import { Router } from "express";
import { rateLimit } from "../../middleware/rate-limit.js";
import { requireTransactionalAuth } from "../../middleware/require-transactional-auth.js";
import { transactionalEmailController } from "./controller.js";

export const transactionalEmailRouter = Router();

const sendRateLimit = rateLimit({
  keyPrefix: "transactional-send",
  windowSeconds: 60,
  max: 120,
  key: (req) => {
    const header = req.headers.authorization;
    return header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : req.ip || "unknown";
  }
});

transactionalEmailRouter.post(
  "/send",
  sendRateLimit,
  requireTransactionalAuth,
  transactionalEmailController.send
);
