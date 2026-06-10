import type { Request, Response } from "express";
import { apiKeyCreateSchema } from "@qqueue/shared";
import { apiKeyService } from "./service.js";

export const apiKeyController = {
  async list(req: Request, res: Response) {
    const organizationId = String(req.query.organizationId ?? "");
    const apiKeys = await apiKeyService.list(organizationId, req.userId!);
    res.json({ data: apiKeys });
  },

  async create(req: Request, res: Response) {
    const input = apiKeyCreateSchema.parse(req.body);
    const result = await apiKeyService.create(input, req.userId!);
    res.status(201).json({ data: result });
  },

  async revoke(req: Request, res: Response) {
    const apiKey = await apiKeyService.revoke(String(req.params.id), req.userId!);
    res.json({ data: apiKey });
  }
};
