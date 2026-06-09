import type { Request, Response } from "express";
import { transactionalEmailService } from "./service.js";

export const transactionalEmailController = {
  async placeholder(_req: Request, res: Response) {
    const result = await transactionalEmailService.placeholder();
    res.json(result);
  }
};
