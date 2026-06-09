import { Router } from "express";
import { templateController } from "./controller.js";

export const templateRouter = Router();

templateRouter.get("/", templateController.placeholder);
