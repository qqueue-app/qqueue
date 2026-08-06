import { Router } from "express";
import { rateLimit } from "../../middleware/rate-limit.js";
import { authController } from "./controller.js";

export const authRouter = Router();

const authWriteLimit = rateLimit({
  keyPrefix: "auth",
  windowSeconds: 15 * 60,
  max: 20,
  key: (req) => req.ip || "unknown"
});

const refreshLimit = rateLimit({
  keyPrefix: "auth-refresh",
  windowSeconds: 15 * 60,
  max: 60,
  key: (req) => req.ip || "unknown"
});

authRouter.post("/register", authWriteLimit, authController.register);
authRouter.post("/login", authWriteLimit, authController.login);
authRouter.post("/refresh", refreshLimit, authController.refresh);
// Revokes the presented refresh token server-side (Phase 5). Public like
// refresh — the token itself is the credential.
authRouter.post("/logout", refreshLimit, authController.logout);
authRouter.post(
  "/password-reset/request",
  authWriteLimit,
  authController.requestPasswordReset
);
authRouter.post("/password-reset/confirm", authWriteLimit, authController.resetPassword);
