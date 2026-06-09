import type { Request, Response } from "express";
import { sendEmailSchema } from "@qqueue/shared";
import { transactionalEmailService } from "./service.js";

export const transactionalEmailController = {
  async send(req: Request, res: Response) {
    const input = sendEmailSchema.parse(req.body);
    const result = await transactionalEmailService.send(input);
    res.status(202).json({ data: result });
  }
};
