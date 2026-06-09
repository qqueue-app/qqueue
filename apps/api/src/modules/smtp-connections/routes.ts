import { Router } from "express";
import { smtpConnectionController } from "./controller.js";

export const smtpConnectionRouter = Router();

smtpConnectionRouter.get("/", smtpConnectionController.placeholder);
