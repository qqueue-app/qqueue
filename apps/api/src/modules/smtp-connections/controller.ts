import type { Request, Response } from "express";
import {
  smtpConnectionGrantCreateSchema,
  smtpConnectionSchema,
  smtpConnectionUpdateSchema
} from "@qqueue/shared";
import { smtpConnectionService } from "./service.js";

export const smtpConnectionController = {
  async list(req: Request, res: Response) {
    const connections = await smtpConnectionService.list(req.organizationId!);
    res.json({ data: connections });
  },

  async listSendable(req: Request, res: Response) {
    const connections = await smtpConnectionService.listSendable(
      req.organizationId!,
      req.userId!
    );
    res.json({ data: connections });
  },

  async listGrants(req: Request, res: Response) {
    const grants = await smtpConnectionService.listGrants(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: grants });
  },

  async addGrant(req: Request, res: Response) {
    const input = smtpConnectionGrantCreateSchema.parse(req.body);
    const grant = await smtpConnectionService.addGrant(
      String(req.params.id),
      req.userId!,
      input.userId
    );
    res.status(201).json({ data: grant });
  },

  async removeGrant(req: Request, res: Response) {
    await smtpConnectionService.removeGrant(
      String(req.params.id),
      req.userId!,
      String(req.params.userId)
    );
    res.status(204).send();
  },

  async get(req: Request, res: Response) {
    const connection = await smtpConnectionService.get(
      String(req.params.id),
      req.userId!
    );

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
      req.userId!,
      input
    );
    res.json({ data: connection });
  },

  async delete(req: Request, res: Response) {
    await smtpConnectionService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  },

  async verify(req: Request, res: Response) {
    const result = await smtpConnectionService.verify(
      String(req.params.id),
      req.userId!
    );
    res.json({ data: result });
  }
};
