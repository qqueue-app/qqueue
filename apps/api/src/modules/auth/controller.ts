import type { Request, Response } from "express";
import { loginSchema, registerSchema } from "@qqueue/shared";
import { authService } from "./service.js";

export const authController = {
  async register(req: Request, res: Response) {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    res.status(201).json({ data: result });
  },

  async login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    res.json({ data: result });
  }
};
