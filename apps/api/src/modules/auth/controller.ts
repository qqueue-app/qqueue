import type { Request, Response } from "express";
import { authService } from "./service.js";

export const authController = {
  async placeholder(_req: Request, res: Response) {
    const result = await authService.placeholder();
    res.json(result);
  }
};
