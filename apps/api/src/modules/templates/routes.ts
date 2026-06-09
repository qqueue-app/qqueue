import { Router } from "express";
import { templateController } from "./controller.js";

export const templateRouter = Router();

templateRouter.get("/", templateController.list);
templateRouter.post("/", templateController.create);
templateRouter.get("/:id", templateController.get);
templateRouter.put("/:id", templateController.update);
templateRouter.delete("/:id", templateController.delete);
