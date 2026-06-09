import { Router } from "express";
import { campaignController } from "./controller.js";

export const campaignRouter = Router();

campaignRouter.get("/", campaignController.placeholder);
