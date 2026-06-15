import type { Request, Response } from "express";
import { suppressionCreateSchema } from "@qqueue/shared";
import { suppressionService } from "./service.js";

export const suppressionController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const suppressions = await suppressionService.list(req.organizationId!);
    res.json({ data: suppressions });
  },

  async create(req: Request, res: Response) {
    const input = suppressionCreateSchema.parse(req.body);
    const suppression = await suppressionService.addSuppression({
      organizationId: input.organizationId,
      email: input.email,
      reason: input.reason,
      source: "manual"
    });
    res.status(201).json({ data: suppression });
  },

  async remove(req: Request, res: Response) {
    await suppressionService.remove(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
