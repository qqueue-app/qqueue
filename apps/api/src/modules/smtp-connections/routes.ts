import { Router } from "express";
import { smtpConnectionController } from "./controller.js";

export const smtpConnectionRouter = Router();

smtpConnectionRouter.get("/", smtpConnectionController.list);
smtpConnectionRouter.post("/", smtpConnectionController.create);
smtpConnectionRouter.get("/:id", smtpConnectionController.get);
smtpConnectionRouter.put("/:id", smtpConnectionController.update);
smtpConnectionRouter.delete("/:id", smtpConnectionController.delete);
smtpConnectionRouter.post("/:id/test", smtpConnectionController.test);
