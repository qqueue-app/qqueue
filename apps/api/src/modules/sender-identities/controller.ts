import type { Request, Response } from "express";
import {
  senderIdentitySchema,
  senderIdentityUpdateSchema
} from "@qqueue/shared";
import { senderIdentityService } from "./service.js";

export const senderIdentityController = {
  async list(req: Request, res: Response) {
    const identities = await senderIdentityService.list(req.organizationId!);
    res.json({ data: identities });
  },

  async get(req: Request, res: Response) {
    const identity = await senderIdentityService.get(
      String(req.params.id),
      req.userId!
    );

    if (!identity) {
      res.status(404).json({ error: { message: "Sender identity not found" } });
      return;
    }

    res.json({ data: identity });
  },

  async create(req: Request, res: Response) {
    const input = senderIdentitySchema.parse(req.body);
    const identity = await senderIdentityService.create(input);
    res.status(201).json({ data: identity });
  },

  async update(req: Request, res: Response) {
    const input = senderIdentityUpdateSchema.parse(req.body);
    const identity = await senderIdentityService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: identity });
  },

  async delete(req: Request, res: Response) {
    await senderIdentityService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  }
};
