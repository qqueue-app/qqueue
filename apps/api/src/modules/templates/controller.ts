import type { Request, Response } from "express";
import { templateService } from "./service.js";

export const templateController = {
  async placeholder(_req: Request, res: Response) {
    const result = await templateService.placeholder();
    res.json(result);
  }
};
