import type { OrganizationInput } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";

export const organizationService = {
  list() {
    return prisma.organization.findMany({
      orderBy: { createdAt: "desc" }
    });
  },

  get(id: string) {
    return prisma.organization.findUnique({
      where: { id }
    });
  },

  create(input: OrganizationInput) {
    return prisma.organization.create({
      data: input
    });
  },

  update(id: string, input: OrganizationInput) {
    return prisma.organization.update({
      where: { id },
      data: input
    });
  },

  delete(id: string) {
    return prisma.organization.delete({
      where: { id }
    });
  }
};
