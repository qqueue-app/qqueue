import { Router } from "express";
import { organizationController } from "./controller.js";

export const organizationRouter = Router();

organizationRouter.get("/", organizationController.placeholder);
