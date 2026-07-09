import type { Request, Response } from "express";
import { setupCompleteSchema } from "@qqueue/shared";
import { setupService } from "./service.js";

export const setupController = {
  async status(_req: Request, res: Response) {
    const result = await setupService.status();
    res.json({ data: result });
  },

  async complete(req: Request, res: Response) {
    const input = setupCompleteSchema.parse(req.body);
    const result = await setupService.complete(req.userId as string, input);
    res.status(201).json({ data: result });
  }
};
