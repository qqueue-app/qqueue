import type { Request, Response } from "express";
import { outboxService } from "./service.js";

export const outboxController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const emails = await outboxService.list(req.organizationId!);
    res.json({ data: emails });
  },

  async cancel(req: Request, res: Response) {
    const result = await outboxService.cancel(
      String(req.params.id),
      req.organizationId!
    );
    res.json({ data: result });
  }
};
