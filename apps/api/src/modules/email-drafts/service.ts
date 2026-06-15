import type { InputJsonValue } from "@prisma/client/runtime/library";
import type { EmailDraftInput, EmailDraftUpdateInput } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

// Drafts are personal: a user only ever sees and edits their own. Scoping every
// query by createdByUserId enforces that even between members of the same org.
export const emailDraftService = {
  list(organizationId: string, userId: string) {
    return prisma.emailDraft.findMany({
      where: { organizationId, createdByUserId: userId },
      orderBy: { updatedAt: "desc" }
    });
  },

  get(id: string, userId: string) {
    return prisma.emailDraft.findFirst({
      where: { id, createdByUserId: userId },
      // Include attachment metadata so resuming a draft restores its files.
      include: {
        attachments: {
          select: { id: true, filename: true, contentType: true, size: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });
  },

  create(input: EmailDraftInput, userId: string) {
    return prisma.emailDraft.create({
      data: {
        organizationId: input.organizationId,
        createdByUserId: userId,
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
        variables: input.variables as InputJsonValue | undefined
      }
    });
  },

  async update(id: string, userId: string, input: EmailDraftUpdateInput) {
    const existing = await prisma.emailDraft.findFirst({
      where: { id, createdByUserId: userId },
      select: { id: true }
    });
    if (!existing) {
      throw new HttpError(404, "Draft not found", "not_found");
    }

    return prisma.emailDraft.update({
      where: { id },
      data: {
        subject: input.subject,
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
        variables: input.variables as InputJsonValue | undefined
      }
    });
  },

  async delete(id: string, userId: string) {
    const { count } = await prisma.emailDraft.deleteMany({
      where: { id, createdByUserId: userId }
    });
    if (count === 0) {
      throw new HttpError(404, "Draft not found", "not_found");
    }
  }
};
