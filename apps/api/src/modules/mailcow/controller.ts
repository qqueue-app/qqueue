import type { Request, Response } from "express";
import { mailboxProvisionSchema } from "@qqueue/shared";
import { mailcowService } from "./service.js";

export const mailcowController = {
  async status(_req: Request, res: Response) {
    res.json({ data: await mailcowService.status() });
  },

  async provision(req: Request, res: Response) {
    const input = mailboxProvisionSchema.parse(req.body);
    const result = await mailcowService.provision(input);
    res.status(201).json({ data: result });
  },
};
