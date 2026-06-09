import { Router } from "express";
import { authController } from "./controller.js";

export const authRouter = Router();

authRouter.get("/", authController.placeholder);
