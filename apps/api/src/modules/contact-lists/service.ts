import type {
  ContactListInput,
  ContactListUpdateInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

const contactListInclude = {
  contacts: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true
    },
    orderBy: { createdAt: "desc" as const }
  },
  _count: { select: { contacts: true, campaigns: true } }
};

async function assertContactsInOrganization(
  organizationId: string,
  contactIds: string[] | undefined
) {
  if (!contactIds?.length) {
    return;
  }

  const uniqueIds = [...new Set(contactIds)];
  const count = await prisma.contact.count({
    where: { organizationId, id: { in: uniqueIds } }
  });

  if (count !== uniqueIds.length) {
    throw new HttpError(400, "One or more contacts do not belong to this organization");
  }
}

async function findOwned(id: string, userId: string) {
  const list = await prisma.contactList.findFirst({
    where: { id, organization: { members: { some: { userId } } } }
  });
  if (!list) {
    throw new HttpError(404, "Contact list not found");
  }
  return list;
}

export const contactListService = {
  list(organizationId: string) {
    return prisma.contactList.findMany({
      where: { organizationId },
      include: contactListInclude,
      orderBy: { createdAt: "desc" }
    });
  },

  get(id: string, userId: string) {
    return prisma.contactList.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: contactListInclude
    });
  },

  async create(input: ContactListInput) {
    await assertContactsInOrganization(input.organizationId, input.contactIds);

    return prisma.contactList.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        contacts: input.contactIds?.length
          ? { connect: [...new Set(input.contactIds)].map((id) => ({ id })) }
          : undefined
      },
      include: contactListInclude
    });
  },

  async update(id: string, userId: string, input: ContactListUpdateInput) {
    const existing = await findOwned(id, userId);
    await assertContactsInOrganization(existing.organizationId, input.contactIds);

    return prisma.contactList.update({
      where: { id },
      data: {
        name: input.name,
        contacts: input.contactIds
          ? { set: [...new Set(input.contactIds)].map((contactId) => ({ id: contactId })) }
          : undefined
      },
      include: contactListInclude
    });
  },

  async delete(id: string, userId: string) {
    await findOwned(id, userId);
    await prisma.contactList.delete({ where: { id } });
  }
};
