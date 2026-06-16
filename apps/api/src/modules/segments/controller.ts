import type { Request, Response } from "express";
import {
  segmentPreviewSchema,
  segmentSchema,
  segmentUpdateSchema
} from "@qqueue/shared";
import { segmentService } from "./service.js";

export const segmentController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const segments = await segmentService.list(req.organizationId!);
    res.json({ data: segments });
  },

  async create(req: Request, res: Response) {
    const input = segmentSchema.parse(req.body);
    const segment = await segmentService.create(input);
    res.status(201).json({ data: segment });
  },

  async preview(req: Request, res: Response) {
    const input = segmentPreviewSchema.parse(req.body);
    const result = await segmentService.preview(input);
    res.json({ data: result });
  },

  async get(req: Request, res: Response) {
    const segment = await segmentService.get(String(req.params.id), req.userId!);
    res.json({ data: segment });
  },

  async update(req: Request, res: Response) {
    const input = segmentUpdateSchema.parse(req.body);
    const segment = await segmentService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: segment });
  },

  async remove(req: Request, res: Response) {
    await segmentService.remove(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
