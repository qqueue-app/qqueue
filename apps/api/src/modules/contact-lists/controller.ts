import type { Request, Response } from "express";
import {
  contactListSchema,
  contactListUpdateSchema,
  createListFromSegmentSchema
} from "@qqueue/shared";
import { contactListService } from "./service.js";

export const contactListController = {
  async list(req: Request, res: Response) {
    const lists = await contactListService.list(req.organizationId!);
    res.json({ data: lists });
  },

  async get(req: Request, res: Response) {
    const list = await contactListService.get(String(req.params.id), req.userId!);

    if (!list) {
      res.status(404).json({ error: { message: "Contact list not found" } });
      return;
    }

    res.json({ data: list });
  },

  async create(req: Request, res: Response) {
    const input = contactListSchema.parse(req.body);
    const list = await contactListService.create(input);
    res.status(201).json({ data: list });
  },

  async createFromSegment(req: Request, res: Response) {
    const input = createListFromSegmentSchema.parse(req.body);
    const list = await contactListService.createFromSegment(input);
    res.status(201).json({ data: list });
  },

  async update(req: Request, res: Response) {
    const input = contactListUpdateSchema.parse(req.body);
    const list = await contactListService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: list });
  },

  async delete(req: Request, res: Response) {
    await contactListService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
