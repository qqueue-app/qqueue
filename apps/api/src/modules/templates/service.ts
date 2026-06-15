import type { TemplateInput } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

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
      data: input
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
      data: {
        name: input.name,
        subject: input.subject,
        html: input.html,
        mjml: input.mjml,
        text: input.text
      }
    });
  },

  async delete(id: string, userId: string) {
    const { count } = await prisma.template.deleteMany({
      where: { id, organization: { members: { some: { userId } } } }
    });
    if (count === 0) {
      throw new HttpError(404, "Template not found");
    }
  }
};
