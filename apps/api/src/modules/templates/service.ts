import type { InputJsonValue } from "@prisma/client/runtime/library";
import {
  applyVariables,
  resolveVariableData,
  type TemplateInput,
  type TemplatePreviewInput,
  type TemplatePreviewResult,
  type TemplateTestSendInput,
  type TemplateVariable
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { transactionalEmailService } from "../transactional-email/service.js";

// Map the validated input onto Prisma's column shape. `variables`/`previewData`
// are JSON columns, so they go through Prisma's JSON input type.
function toData(input: TemplateInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    category: input.category ?? null,
    tags: input.tags ?? [],
    subject: input.subject,
    html: input.html,
    mjml: input.mjml ?? null,
    text: input.text ?? null,
    variables: (input.variables ?? undefined) as InputJsonValue | undefined,
    previewData: (input.previewData ?? undefined) as InputJsonValue | undefined
  };
}

export const templateService = {
  list(organizationId: string) {
    return prisma.template.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" }
    });
  },

  // Scoped by membership: only resolves templates in an org the user belongs to.
  get(id: string, userId: string) {
    return prisma.template.findFirst({
      where: { id, organization: { members: { some: { userId } } } }
    });
  },

  create(input: TemplateInput) {
    return prisma.template.create({
      data: { organizationId: input.organizationId, ...toData(input) }
    });
  },

  async update(id: string, userId: string, input: TemplateInput) {
    const existing = await prisma.template.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      select: { id: true }
    });
    if (!existing) {
      throw new HttpError(404, "Template not found");
    }

    return prisma.template.update({
      where: { id },
      data: toData(input)
    });
  },

  async delete(id: string, userId: string) {
    const { count } = await prisma.template.deleteMany({
      where: { id, organization: { members: { some: { userId } } } }
    });
    if (count === 0) {
      throw new HttpError(404, "Template not found");
    }
  },

  // Duplicate a template the user can access, suffixing the name with " copy".
  async clone(id: string, userId: string) {
    const source = await prisma.template.findFirst({
      where: { id, organization: { members: { some: { userId } } } }
    });
    if (!source) {
      throw new HttpError(404, "Template not found");
    }

    return prisma.template.create({
      data: {
        organizationId: source.organizationId,
        name: `${source.name} copy`,
        description: source.description,
        category: source.category,
        tags: source.tags,
        subject: source.subject,
        html: source.html,
        mjml: source.mjml,
        text: source.text,
        variables: (source.variables ?? undefined) as InputJsonValue | undefined,
        previewData: (source.previewData ??
          undefined) as InputJsonValue | undefined
      }
    });
  },

  /**
   * Resolve a template's subject + body with sample data, mirroring the send
   * pipeline's variable substitution exactly (so the dashboard preview matches
   * what recipients receive). Tracking is intentionally NOT injected — previews
   * must not mint click/open tracking URLs.
   */
  async preview(
    input: TemplatePreviewInput,
    userId: string
  ): Promise<TemplatePreviewResult> {
    let subject = input.subject ?? "";
    let html = input.html ?? "";
    let variables = (input.variables ?? null) as TemplateVariable[] | null;

    if (input.templateId) {
      const template = await prisma.template.findFirst({
        where: {
          id: input.templateId,
          organizationId: input.organizationId,
          organization: { members: { some: { userId } } }
        }
      });
      if (!template) {
        throw new HttpError(404, "Template not found");
      }
      subject = input.subject ?? template.subject;
      html = input.html ?? template.html;
      variables =
        variables ?? (template.variables as TemplateVariable[] | null);
    }

    const data = resolveVariableData(variables, input.data);
    return {
      subject: applyVariables(subject, data),
      html: applyVariables(html, data)
    };
  },

  /**
   * Send a one-off test of a template to the requesting user (or an explicit
   * recipient). Routes through the single delivery pipeline as a MANUAL send —
   * no parallel send path.
   */
  async testSend(id: string, userId: string, input: TemplateTestSendInput) {
    const template = await prisma.template.findFirst({
      where: {
        id,
        organizationId: input.organizationId,
        organization: { members: { some: { userId } } }
      }
    });
    if (!template) {
      throw new HttpError(404, "Template not found");
    }

    let to = input.to;
    if (!to) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });
      if (!user) {
        throw new HttpError(404, "User not found");
      }
      to = user.email;
    }

    const variables = template.variables as TemplateVariable[] | null;
    const data = resolveVariableData(variables, input.data);

    return transactionalEmailService.send({
      organizationId: input.organizationId,
      to,
      subject: applyVariables(template.subject, data),
      html: applyVariables(template.html, data),
      text: template.text ? applyVariables(template.text, data) : undefined,
      smtpConnectionId: input.smtpConnectionId,
      origin: "MANUAL",
      createdByUserId: userId
    });
  }
};
