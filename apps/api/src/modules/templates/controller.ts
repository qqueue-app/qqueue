import type { Request, Response } from "express";
import {
  templatePreviewSchema,
  templateSchema,
  templateTestSendSchema
} from "@qqueue/shared";
import { templateService } from "./service.js";

export const templateController = {
  async list(req: Request, res: Response) {
    const templates = await templateService.list(req.organizationId!);
    res.json({ data: templates });
  },

  async get(req: Request, res: Response) {
    const template = await templateService.get(
      String(req.params.id),
      req.userId!
    );

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
    const template = await templateService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: template });
  },

  async delete(req: Request, res: Response) {
    await templateService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  },

  async clone(req: Request, res: Response) {
    const template = await templateService.clone(
      String(req.params.id),
      req.userId!
    );
    res.status(201).json({ data: template });
  },

  async preview(req: Request, res: Response) {
    const input = templatePreviewSchema.parse(req.body);
    const result = await templateService.preview(input, req.userId!);
    res.json({ data: result });
  },

  async testSend(req: Request, res: Response) {
    const input = templateTestSendSchema.parse(req.body);
    const result = await templateService.testSend(
      String(req.params.id),
      req.userId!,
      input
    );
    res.status(202).json({ data: result });
  }
};
