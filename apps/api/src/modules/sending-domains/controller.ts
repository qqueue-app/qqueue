import type { Request, Response } from "express";
import {
  sendingDomainSchema,
  sendingDomainUpdateSchema
} from "@qqueue/shared";
import { sendingDomainService } from "./service.js";

export const sendingDomainController = {
  async list(req: Request, res: Response) {
    const domains = await sendingDomainService.list(req.organizationId!);
    res.json({ data: domains });
  },

  async get(req: Request, res: Response) {
    const domain = await sendingDomainService.get(
      String(req.params.id),
      req.userId!
    );

    if (!domain) {
      res.status(404).json({ error: { message: "Sending domain not found" } });
      return;
    }

    res.json({ data: domain });
  },

  async create(req: Request, res: Response) {
    const input = sendingDomainSchema.parse(req.body);
    const domain = await sendingDomainService.create(input);
    res.status(201).json({ data: domain });
  },

  async update(req: Request, res: Response) {
    const input = sendingDomainUpdateSchema.parse(req.body);
    const domain = await sendingDomainService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: domain });
  },

  async delete(req: Request, res: Response) {
    await sendingDomainService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
