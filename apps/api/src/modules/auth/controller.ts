import type { Request, Response } from "express";
import {
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSchema,
  registerSchema
} from "@qqueue/shared";
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
  },

  async refresh(req: Request, res: Response) {
    const input = refreshSchema.parse(req.body);
    const result = await authService.refresh(input.refreshToken);
    res.json({ data: result });
  },

  async requestPasswordReset(req: Request, res: Response) {
    const input = passwordResetRequestSchema.parse(req.body);
    const result = await authService.requestPasswordReset(input.email);
    res.json({ data: result });
  },

  async resetPassword(req: Request, res: Response) {
    const input = passwordResetConfirmSchema.parse(req.body);
    const result = await authService.resetPassword(input.token, input.password);
    res.json({ data: result });
  }
};
