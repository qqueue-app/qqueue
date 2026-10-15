import { createHash } from "node:crypto";
import { isPrismaKnownRequestError } from "../../lib/prisma-error.js";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import type {
  EmailDraftInput,
  EmailDraftUpdateInput,
  MailboxDraftReviewInput,
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { assertMayUseConnection } from "../../lib/send-as.js";
import {
  mailboxDraftSource,
  mailboxDraftStatus,
} from "../../lib/mailbox-draft-source.js";

// Drafts are personal: a user only ever sees and edits their own. Scoping every
// query by createdByUserId enforces that even between members of the same org.
export const emailDraftService = {
  async sourceStatus(id: string, userId: string) {
    return prisma.$transaction(async (db) => {
      const draft = await db.emailDraft.findFirst({
        where: { id, createdByUserId: userId, deletedAt: null },
      });
      if (!draft?.mailboxDraftSource)
        throw new HttpError(404, "Mailbox draft copy not found", "not_found");
      return mailboxDraftStatus(
        mailboxDraftSource(draft.mailboxDraftSource),
        draft.organizationId,
        userId,
        db
      );
    });
  },
  async reviewSource(
    id: string,
    userId: string,
    input: MailboxDraftReviewInput
  ) {
    return prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"draft:" + id},0))`;
      const draft = await db.emailDraft.findFirst({
        where: { id, createdByUserId: userId, deletedAt: null },
      });
      if (!draft?.mailboxDraftSource)
        throw new HttpError(404, "Mailbox draft copy not found", "not_found");
      const source = mailboxDraftSource(draft.mailboxDraftSource);
      const status = await mailboxDraftStatus(
        source,
        draft.organizationId,
        userId,
        db
      );
      if (
        draft.completedSendId ||
        draft.revision !== input.expectedRevision ||
        status.state === "LOADING" ||
        status.currentVersion !== input.expectedVersion
      )
        throw new HttpError(
          409,
          "The saved writing or mailbox draft changed again. Review its latest version before choosing.",
          "mailbox_draft_conflict"
        );
      const updated = await db.emailDraft.updateMany({
        where: {
          id,
          createdByUserId: userId,
          revision: input.expectedRevision,
          deletedAt: null,
          completedSendId: null,
        },
        data: {
          mailboxDraftSource: {
            ...source,
            reviewedVersion: status.currentVersion,
          },
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new HttpError(
          409,
          "This private copy changed while you were reviewing it. Reopen it to compare the writing.",
          "draft_conflict"
        );
      return db.emailDraft.findFirstOrThrow({
        where: { id, createdByUserId: userId },
      });
    });
  },
  list(organizationId: string, userId: string) {
    return prisma.emailDraft.findMany({
      where: {
        organizationId,
        createdByUserId: userId,
        completedSendId: null,
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
    });
  },

  get(id: string, userId: string) {
    return prisma.emailDraft.findFirst({
      where: { id, createdByUserId: userId, deletedAt: null },
      // Include attachment metadata so resuming a draft restores its files.
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
            cid: true,
            uploadId: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  },

  async create(input: EmailDraftInput, userId: string) {
    // A draft naming an ungranted sending account would only fail later, at
    // send time — reject it here where the picker can react (Phase 4).
    if (input.smtpConnectionId) {
      await assertMayUseConnection({
        userId,
        organizationId: input.organizationId,
        smtpConnectionId: input.smtpConnectionId,
      });
    }
    const creationHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    try {
      return await prisma.emailDraft.create({
        data: {
          clientId: input.clientId,
          creationHash,
          organizationId: input.organizationId,
          createdByUserId: userId,
          inboundMessageId: input.inboundMessageId,
          subject: input.subject ?? "",
          html: input.html,
          text: input.text,
          to: input.to ?? [],
          cc: input.cc ?? [],
          bcc: input.bcc ?? [],
          contactIds: input.contactIds ?? [],
          listIds: input.listIds ?? [],
          replyTo: input.replyTo,
          smtpConnectionId: input.smtpConnectionId,
          templateId: input.templateId,
          variables: input.variables as InputJsonValue | undefined,
        },
      });
    } catch (error) {
      if (input.clientId && isPrismaKnownRequestError(error, "P2002")) {
        const draft = await prisma.emailDraft.findFirst({
          where: {
            organizationId: input.organizationId,
            createdByUserId: userId,
            clientId: input.clientId,
          },
        });
        if (draft) {
          if (
            draft.deletedAt ||
            draft.completedSendId ||
            draft.revision > 1 ||
            draft.creationHash !== creationHash
          )
            throw new HttpError(
              409,
              "This draft already exists with different content or has been completed. Your writing has been kept; open Drafts or Outbox to review it.",
              "draft_conflict"
            );
          return draft;
        }
      }
      throw error;
    }
  },

  async update(id: string, userId: string, input: EmailDraftUpdateInput) {
    return prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"draft:" + id}, 0))`;
      const existing = await db.emailDraft.findFirst({
        where: { id, createdByUserId: userId, deletedAt: null },
      });
      if (!existing) {
        throw new HttpError(404, "Draft not found", "not_found");
      }

      if (existing.completedSendId)
        throw new HttpError(
          409,
          "This draft has already been accepted for sending. Check Sent or Outbox.",
          "draft_completed"
        );
      if (existing.lastMutationId === input.mutationId) return existing;
      if (existing.revision !== input.expectedRevision)
        throw new HttpError(
          409,
          "This draft changed on another tab or device. Your writing has been kept; reopen the saved draft to compare it.",
          "draft_conflict"
        );
      if (input.smtpConnectionId) {
        await assertMayUseConnection({
          userId,
          organizationId: existing.organizationId,
          smtpConnectionId: input.smtpConnectionId,
        });
      }

      const result = await db.emailDraft.updateMany({
        where: {
          id,
          createdByUserId: userId,
          revision: input.expectedRevision,
          completedSendId: null,
          deletedAt: null,
        },
        data: {
          revision: { increment: 1 },
          lastMutationId: input.mutationId,
          subject: input.subject,
          inboundMessageId: input.inboundMessageId,
          html: input.html,
          text: input.text,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          contactIds: input.contactIds,
          listIds: input.listIds,
          replyTo: input.replyTo,
          smtpConnectionId: input.smtpConnectionId,
          templateId: input.templateId,
          variables: input.variables as InputJsonValue | undefined,
        },
      });
      if (result.count !== 1)
        throw new HttpError(
          409,
          "This draft changed before saving. Your writing has been kept.",
          "draft_conflict"
        );
      return db.emailDraft.findFirstOrThrow({
        where: { id, createdByUserId: userId },
      });
    });
  },

  async delete(id: string, userId: string) {
    const { count } = await prisma.emailDraft.updateMany({
      where: {
        id,
        createdByUserId: userId,
        completedSendId: null,
        deletedAt: null,
      },
      data: { deletedAt: new Date(), revision: { increment: 1 } },
    });
    if (count === 0) {
      throw new HttpError(404, "Draft not found", "not_found");
    }
  },
};
