import type { Request, Response } from "express";
import { dashboardService } from "./service.js";

export const dashboardController = {
  async summary(req: Request, res: Response) {
    const summary = await dashboardService.summary(
      req.organizationId!,
      req.userId!
    );
    res.json({ data: summary });
  }
};
