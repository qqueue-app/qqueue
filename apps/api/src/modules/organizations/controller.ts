import type { Request, Response } from "express";
import { organizationService } from "./service.js";

export const organizationController = {
  async placeholder(_req: Request, res: Response) {
    const result = await organizationService.placeholder();
    res.json(result);
  }
};
