import type { Request, Response } from "express";
import { campaignService } from "./service.js";

export const campaignController = {
  async placeholder(_req: Request, res: Response) {
    const result = await campaignService.placeholder();
    res.json(result);
  }
};
