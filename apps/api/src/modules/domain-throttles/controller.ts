import type { Request, Response } from "express";
import { domainThrottleSchema } from "@qqueue/shared";
import { domainThrottleService } from "./service.js";

export const domainThrottleController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const throttles = await domainThrottleService.list(req.organizationId!);
    res.json({
      data: {
        throttles,
        defaultPerMinute: domainThrottleService.defaultPerMinute()
      }
    });
  },

  async upsert(req: Request, res: Response) {
    const input = domainThrottleSchema.parse(req.body);
    const throttle = await domainThrottleService.upsert(input);
    res.json({ data: throttle });
  },

  async remove(req: Request, res: Response) {
    await domainThrottleService.remove(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
