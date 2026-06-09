import { Router } from "express";
import { contactController } from "./controller.js";

export const contactRouter = Router();

contactRouter.get("/", contactController.list);
contactRouter.post("/", contactController.create);
contactRouter.get("/:id", contactController.get);
contactRouter.put("/:id", contactController.update);
contactRouter.delete("/:id", contactController.delete);
