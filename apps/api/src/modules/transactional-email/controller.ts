import type { Request, Response } from "express";
import { publicSendEmailSchema } from "@qqueue/shared";
import { transactionalEmailService } from "./service.js";

export const transactionalEmailController = {
  async send(req: Request, res: Response) {
    const payload = publicSendEmailSchema.parse(req.body);
    const input = { ...payload, organizationId: req.organizationId! };
    const result = await transactionalEmailService.send(input);
    res.status(202).json({ data: result });
  }
};
