import type { Request, Response } from "express";
import { deliverabilityQuerySchema } from "@qqueue/shared";
import { deliverabilityService } from "./service.js";

function parseQuery(req: Request) {
  return deliverabilityQuerySchema.parse({
    organizationId: req.organizationId!,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined
  });
}

export const deliverabilityController = {
  async overview(req: Request, res: Response) {
    const data = await deliverabilityService.overview(parseQuery(req));
    res.json({ data });
  },

  async domains(req: Request, res: Response) {
    const data = await deliverabilityService.domains(parseQuery(req));
    res.json({ data });
  },

  async alerts(req: Request, res: Response) {
    const data = await deliverabilityService.alerts(parseQuery(req));
    res.json({ data });
  }
};
