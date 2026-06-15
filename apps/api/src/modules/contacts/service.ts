import type { InputJsonValue } from "@prisma/client/runtime/library";
import type { ContactInput } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

export const contactService = {
  list(organizationId: string) {
    return prisma.contact.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" }
    });
  },

  // Scoped by membership: only resolves contacts in an org the user belongs to.
  get(id: string, userId: string) {
    return prisma.contact.findFirst({
      where: { id, organization: { members: { some: { userId } } } }
    });
  },

  create(input: ContactInput) {
    return prisma.contact.create({
      data: {
        ...input,
        metadata: input.metadata as InputJsonValue | undefined
      }
    });
  },

  async update(id: string, userId: string, input: ContactInput) {
    const existing = await prisma.contact.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      select: { id: true }
    });
    if (!existing) {
      throw new HttpError(404, "Contact not found");
    }

    return prisma.contact.update({
      where: { id },
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        tags: input.tags,
        metadata: input.metadata as InputJsonValue | undefined
      }
    });
  },

  async delete(id: string, userId: string) {
    const { count } = await prisma.contact.deleteMany({
      where: { id, organization: { members: { some: { userId } } } }
    });
    if (count === 0) {
      throw new HttpError(404, "Contact not found");
    }
  }
};
