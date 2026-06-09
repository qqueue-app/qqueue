import { Prisma } from "@prisma/client";
import type { ContactInput } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";

export const contactService = {
  list(organizationId?: string) {
    return prisma.contact.findMany({
      where: organizationId ? { organizationId } : undefined,
      orderBy: { createdAt: "desc" }
    });
  },

  get(id: string) {
    return prisma.contact.findUnique({
      where: { id }
    });
  },

  create(input: ContactInput) {
    return prisma.contact.create({
      data: {
        ...input,
        metadata: input.metadata as Prisma.InputJsonValue | undefined
      }
    });
  },

  update(id: string, input: ContactInput) {
    return prisma.contact.update({
      where: { id },
      data: {
        ...input,
        metadata: input.metadata as Prisma.InputJsonValue | undefined
      }
    });
  },

  delete(id: string) {
    return prisma.contact.delete({
      where: { id }
    });
  }
};
