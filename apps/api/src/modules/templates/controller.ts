import type { Request, Response } from "express";
import { templateSchema } from "@qqueue/shared";
import { templateService } from "./service.js";

export const templateController = {
  async list(req: Request, res: Response) {
    const organizationId =
      typeof req.query.organizationId === "string"
        ? req.query.organizationId
        : undefined;
    const templates = await templateService.list(organizationId);
    res.json({ data: templates });
  },

  async get(req: Request, res: Response) {
    const template = await templateService.get(String(req.params.id));

    if (!template) {
      res.status(404).json({ error: { message: "Template not found" } });
      return;
    }

    res.json({ data: template });
  },

  async create(req: Request, res: Response) {
    const input = templateSchema.parse(req.body);
    const template = await templateService.create(input);
    res.status(201).json({ data: template });
  },

  async update(req: Request, res: Response) {
    const input = templateSchema.parse(req.body);
    const template = await templateService.update(String(req.params.id), input);
    res.json({ data: template });
  },

  async delete(req: Request, res: Response) {
    await templateService.delete(String(req.params.id));
    res.status(204).send();
  }
};
