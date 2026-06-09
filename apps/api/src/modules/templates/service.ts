import type { TemplateInput } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";

export const templateService = {
  list(organizationId?: string) {
    return prisma.template.findMany({
      where: organizationId ? { organizationId } : undefined,
      orderBy: { createdAt: "desc" }
    });
  },

  get(id: string) {
    return prisma.template.findUnique({
      where: { id }
    });
  },

  create(input: TemplateInput) {
    return prisma.template.create({
      data: input
    });
  },

  update(id: string, input: TemplateInput) {
    return prisma.template.update({
      where: { id },
      data: input
    });
  },

  delete(id: string) {
    return prisma.template.delete({
      where: { id }
    });
  }
};
