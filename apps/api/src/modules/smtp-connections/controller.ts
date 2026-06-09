import type { Request, Response } from "express";
import {
  smtpConnectionSchema,
  smtpConnectionUpdateSchema
} from "@qqueue/shared";
import { smtpConnectionService } from "./service.js";

export const smtpConnectionController = {
  async list(req: Request, res: Response) {
    const organizationId =
      typeof req.query.organizationId === "string"
        ? req.query.organizationId
        : undefined;
    const connections = await smtpConnectionService.list(organizationId);
    res.json({ data: connections });
  },

  async get(req: Request, res: Response) {
    const connection = await smtpConnectionService.get(String(req.params.id));

    if (!connection) {
      res.status(404).json({ error: { message: "SMTP connection not found" } });
      return;
    }

    res.json({ data: connection });
  },

  async create(req: Request, res: Response) {
    const input = smtpConnectionSchema.parse(req.body);
    const connection = await smtpConnectionService.create(input);
    res.status(201).json({ data: connection });
  },

  async update(req: Request, res: Response) {
    const input = smtpConnectionUpdateSchema.parse(req.body);
    const connection = await smtpConnectionService.update(
      String(req.params.id),
      input
    );
    res.json({ data: connection });
  },

  async delete(req: Request, res: Response) {
    await smtpConnectionService.delete(String(req.params.id));
    res.status(204).send();
  },

  async test(req: Request, res: Response) {
    const result = await smtpConnectionService.test(String(req.params.id));
    res.json({ data: result });
  }
};
