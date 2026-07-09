import type { Request, Response } from "express";
import { instanceSettingsUpdateSchema } from "@qqueue/shared";
import { instanceSettingsService } from "./service.js";

export const instanceSettingsController = {
  async get(_req: Request, res: Response) {
    const result = await instanceSettingsService.get();
    res.json({ data: result });
  },

  async update(req: Request, res: Response) {
    const input = instanceSettingsUpdateSchema.parse(req.body);
    const result = await instanceSettingsService.update(input);
    res.json({ data: result });
  },

  async envStatus(_req: Request, res: Response) {
    const result = await instanceSettingsService.envStatus();
    res.json({ data: result });
  }
};
