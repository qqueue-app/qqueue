import type { Request, Response } from "express";
import { smtpConnectionService } from "./service.js";

export const smtpConnectionController = {
  async placeholder(_req: Request, res: Response) {
    const result = await smtpConnectionService.placeholder();
    res.json(result);
  }
};
