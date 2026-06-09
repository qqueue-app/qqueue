import type { Request, Response } from "express";
import { contactService } from "./service.js";

export const contactController = {
  async placeholder(_req: Request, res: Response) {
    const result = await contactService.placeholder();
    res.json(result);
  }
};
