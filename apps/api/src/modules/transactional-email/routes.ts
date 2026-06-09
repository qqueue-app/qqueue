import { Router } from "express";
import { transactionalEmailController } from "./controller.js";

export const transactionalEmailRouter = Router();

transactionalEmailRouter.post("/send", transactionalEmailController.send);
