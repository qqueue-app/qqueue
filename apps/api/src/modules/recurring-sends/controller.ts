import type { Request, Response } from "express";
import {
  recurringSendCreateSchema,
  recurringSendUpdateSchema
} from "@qqueue/shared";
import { recurringSendService } from "./service.js";

export const recurringSendController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const sends = await recurringSendService.list(req.organizationId!);
    res.json({ data: sends });
  },

  async get(req: Request, res: Response) {
    const send = await recurringSendService.get(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: send });
  },

  async create(req: Request, res: Response) {
    const input = recurringSendCreateSchema.parse(req.body);
    const send = await recurringSendService.create(input, req.userId!);
    res.status(201).json({ data: send });
  },

  async update(req: Request, res: Response) {
    const input = recurringSendUpdateSchema.parse(req.body);
    const send = await recurringSendService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: send });
  },

  async pause(req: Request, res: Response) {
    const send = await recurringSendService.pause(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: send });
  },

  async resume(req: Request, res: Response) {
    const send = await recurringSendService.resume(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: send });
  },

  async delete(req: Request, res: Response) {
    await recurringSendService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
