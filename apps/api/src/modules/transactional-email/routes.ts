import { Router } from "express";
import { requireTransactionalAuth } from "../../middleware/require-transactional-auth.js";
import { transactionalEmailController } from "./controller.js";

export const transactionalEmailRouter = Router();

transactionalEmailRouter.post(
  "/send",
  requireTransactionalAuth,
  transactionalEmailController.send
);
