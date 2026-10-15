import type { Request, Response } from "express";
import {
  inboxAccountSchema,
  inboxAccountUpdateSchema,
  inboundMessageQuerySchema,
  inboundMessageReplySchema,
  inboundMessageStoreSchema,
  inboundBulkReadSchema,
  inboundFlagSchema,
  inboxMoveSchema,
  inboundForwardSchema,
} from "@qqueue/shared";
import { z } from "zod";
import { inboxService } from "./service.js";
import { inboxForwardService } from "./forward-service.js";
import { inboxMoveService } from "./move-service.js";

const markReadSchema = z.object({
  read: z
    .union([
      z.boolean(),
      z.enum(["true", "false"]).transform((v) => v === "true"),
    ])
    .default(true),
});

export const inboxController = {
  async prepareForward(req: Request, res: Response) {
    res
      .status(201)
      .json({
        data: await inboxForwardService.prepare(
          String(req.params.id),
          req.organizationId!,
          req.userId!,
          inboundForwardSchema.parse(req.body)
        ),
      });
  },
  async createMove(req: Request, res: Response) {
    res.status(202).json({
      data: await inboxMoveService.create(
        String(req.params.id),
        req.organizationId!,
        req.userId!,
        inboxMoveSchema.parse(req.body)
      ),
    });
  },
  async moveBatch(req: Request, res: Response) {
    res.json({
      data: await inboxMoveService.getBatch(
        String(req.params.id),
        req.organizationId!,
        req.userId!
      ),
    });
  },
  async recentMoves(req: Request, res: Response) {
    res.json({
      data: await inboxMoveService.recent(
        String(req.params.id),
        req.organizationId!,
        req.userId!
      ),
    });
  },
  async checkMoves(req: Request, res: Response) {
    res.status(202).json({
      data: await inboxMoveService.check(
        String(req.params.id),
        req.organizationId!,
        req.userId!
      ),
    });
  },
  async listFolders(req: Request, res: Response) {
    const query = z
      .object({ inboxAccountId: z.string().min(1).optional() })
      .parse(req.query);
    res.json({
      data: await inboxService.listFolders(
        req.organizationId!,
        req.userId!,
        query.inboxAccountId
      ),
    });
  },
  async markFlagged(req: Request, res: Response) {
    const input = inboundFlagSchema.parse(req.body);
    res.json({
      data: await inboxService.markFlagged(
        String(req.params.id),
        req.organizationId!,
        req.userId!,
        input.flagged
      ),
    });
  },
  async retryContent(req: Request, res: Response) {
    res.status(202).json({
      data: await inboxService.retryContent(
        String(req.params.id),
        req.organizationId!,
        req.userId!
      ),
    });
  },
  async requestSync(req: Request, res: Response) {
    const input = z
      .object({ inboxAccountId: z.string().min(1).optional() })
      .parse(req.body);
    res.status(202).json({
      data: await inboxService.requestSync(
        req.organizationId!,
        req.userId!,
        input.inboxAccountId
      ),
    });
  },
  async getConversation(req: Request, res: Response) {
    res.json({
      data: await inboxService.getConversation(
        String(req.params.id),
        req.organizationId!,
        req.userId!
      ),
    });
  },
  async listAccounts(req: Request, res: Response) {
    const accounts = await inboxService.listAccounts(
      req.organizationId!,
      req.userId!
    );
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
      input,
      req.organizationId!
    );
    res.json({ data: account });
  },

  async deleteAccount(req: Request, res: Response) {
    await inboxService.deleteAccount(
      String(req.params.id),
      req.userId!,
      req.organizationId!
    );
    res.status(204).send();
  },

  async listMessages(req: Request, res: Response) {
    const query = inboundMessageQuerySchema.parse({
      ...req.query,
      // requireOrgMembership already verified this one; take it from there
      // rather than trusting the query string a second time.
      organizationId: req.organizationId!,
    });
    const messages = await inboxService.listMessages(query, req.userId!);
    res.json({ data: messages });
  },

  async unreadCount(req: Request, res: Response) {
    const result = await inboxService.unreadCount(
      req.organizationId!,
      req.userId!
    );
    res.json({ data: result });
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
      req.organizationId!,
      input.read
    );
    res.json({ data: message });
  },

  async markManyRead(req: Request, res: Response) {
    const input = inboundBulkReadSchema.parse({
      ...req.body,
      organizationId: req.organizationId!,
    });
    res.json({
      data: await inboxService.markManyRead(
        input.organizationId,
        req.userId!,
        input.messageIds,
        input.read
      ),
    });
  },

  async downloadAttachment(req: Request, res: Response) {
    const { attachment, body } = await inboxService.downloadAttachment(
      String(req.params.attachmentId),
      req.userId!,
      req.organizationId!
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
