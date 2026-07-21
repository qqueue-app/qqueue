import type { Request, Response } from "express";
import {
  inboxAccountSchema,
  inboxAccountUpdateSchema,
  inboundMessageQuerySchema,
  inboundMessageReplySchema,
  inboundMessageStoreSchema,
} from "@qqueue/shared";
import { z } from "zod";
import { inboxService } from "./service.js";

const markReadSchema = z.object({
  read: z
    .union([
      z.boolean(),
      z.enum(["true", "false"]).transform((v) => v === "true"),
    ])
    .default(true),
});

export const inboxController = {
  async listAccounts(req: Request, res: Response) {
    const accounts = await inboxService.listAccounts(req.organizationId!);
    res.json({ data: accounts });
  },

  async createAccount(req: Request, res: Response) {
    const input = inboxAccountSchema.parse(req.body);
    const account = await inboxService.createAccount(input);
    res.status(201).json({ data: account });
  },

  async updateAccount(req: Request, res: Response) {
    const input = inboxAccountUpdateSchema.parse(req.body);
    const account = await inboxService.updateAccount(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: account });
  },

  async deleteAccount(req: Request, res: Response) {
    await inboxService.deleteAccount(String(req.params.id), req.userId!);
    res.status(204).send();
  },

  async listMessages(req: Request, res: Response) {
    const query = inboundMessageQuerySchema.parse(req.query);
    const messages = await inboxService.listMessages(query);
    res.json({ data: messages });
  },

  async storeInboundMessage(req: Request, res: Response) {
    // Temporary Phase E foundation endpoint. The IMAP sync worker will call the
    // same service directly once real read-only sync is wired.
    const input = inboundMessageStoreSchema.parse(req.body);
    const message = await inboxService.storeInboundMessage(input);
    res.status(201).json({ data: message });
  },

  async markRead(req: Request, res: Response) {
    const input = markReadSchema.parse(req.body);
    const message = await inboxService.markRead(
      String(req.params.id),
      req.userId!,
      input.read
    );
    res.json({ data: message });
  },

  async downloadAttachment(req: Request, res: Response) {
    const { attachment, body } = await inboxService.downloadAttachment(
      String(req.params.attachmentId),
      req.userId!
    );

    res.setHeader("Content-Type", attachment.contentType);
    // Always force a download rather than letting the browser render it: this
    // is a file from an untrusted sender, and inline rendering of e.g. an
    // text/html part would execute it on our own origin.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachment.filename.replace(/"/g, "")}"`
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  },

  async replyToMessage(req: Request, res: Response) {
    const input = inboundMessageReplySchema.parse(req.body);
    const result = await inboxService.replyToMessage(
      String(req.params.id),
      req.userId!,
      input
    );
    res.status(202).json({ data: result });
  },
};
