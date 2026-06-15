import type { Request, Response } from "express";
import { emailDraftSchema, emailDraftUpdateSchema } from "@qqueue/shared";
import { emailDraftService } from "./service.js";

export const emailDraftController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const drafts = await emailDraftService.list(
      req.organizationId!,
      req.userId!
    );
    res.json({ data: drafts });
  },

  async get(req: Request, res: Response) {
    const draft = await emailDraftService.get(
      String(req.params.id),
      req.userId!
    );
    if (!draft) {
      res.status(404).json({ error: { message: "Draft not found" } });
      return;
    }
    res.json({ data: draft });
  },

  async create(req: Request, res: Response) {
    const input = emailDraftSchema.parse(req.body);
    const draft = await emailDraftService.create(input, req.userId!);
    res.status(201).json({ data: draft });
  },

  async update(req: Request, res: Response) {
    const input = emailDraftUpdateSchema.parse(req.body);
    const draft = await emailDraftService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: draft });
  },

  async delete(req: Request, res: Response) {
    await emailDraftService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
