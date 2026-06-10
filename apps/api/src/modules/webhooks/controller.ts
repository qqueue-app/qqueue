import type { Request, Response } from "express";
import {
  webhookEndpointSchema,
  webhookEndpointUpdateSchema
} from "@qqueue/shared";
import { webhookEndpointService } from "./service.js";

export const webhookEndpointController = {
  async list(req: Request, res: Response) {
    const endpoints = await webhookEndpointService.list(
      req.organizationId!,
      req.userId!
    );
    res.json({ data: endpoints });
  },

  async create(req: Request, res: Response) {
    const input = webhookEndpointSchema.parse(req.body);
    const result = await webhookEndpointService.create(input, req.userId!);
    res.status(201).json({ data: result });
  },

  async update(req: Request, res: Response) {
    const input = webhookEndpointUpdateSchema.parse(req.body);
    const endpoint = await webhookEndpointService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: endpoint });
  },

  async delete(req: Request, res: Response) {
    await webhookEndpointService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  },

  async listDeliveries(req: Request, res: Response) {
    const deliveries = await webhookEndpointService.listDeliveries(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: deliveries });
  }
};
