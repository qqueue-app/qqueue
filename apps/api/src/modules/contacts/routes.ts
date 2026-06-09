import { Router } from "express";
import { contactController } from "./controller.js";

export const contactRouter = Router();

contactRouter.get("/", contactController.placeholder);
