import type {
  ContactListInput,
  ContactListUpdateInput,
  CreateListFromSegmentInput
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";
import { buildSegmentWhere } from "../contacts/segment.js";

// Membership is an explicit join (ContactListMember). We hydrate the related
// contact and a member/campaign count, then flatten back to the legacy
// `contacts` + `_count.contacts` shape so existing API/dashboard consumers are
// unaffected by the join-table migration.
const contactListInclude = {
  members: {
    include: {
      contact: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true
        }
      }
    },
    orderBy: { addedAt: "desc" as const }
  },
  _count: { select: { members: true, campaigns: true } }
};

type ContactListWithMembers = {
  members: { contact: unknown }[];
  _count: { members: number; campaigns: number };
  [key: string]: unknown;
};

// Present the explicit membership as the historical `contacts` array so the API
// contract (and the web dashboard) stays identical to the implicit-M2M era.
function toResponse(list: ContactListWithMembers) {
  const { members, _count, ...rest } = list;
  return {
    ...rest,
    contacts: members.map((member) => member.contact),
    _count: { contacts: _count.members, campaigns: _count.campaigns }
  };
}

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
  async list(organizationId: string) {
    const lists = await prisma.contactList.findMany({
      where: { organizationId },
      include: contactListInclude,
      orderBy: { createdAt: "desc" }
    });
    return lists.map((list) => toResponse(list as unknown as ContactListWithMembers));
  },

  async get(id: string, userId: string) {
    const list = await prisma.contactList.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: contactListInclude
    });
    return list ? toResponse(list as unknown as ContactListWithMembers) : null;
  },

  async create(input: ContactListInput) {
    await assertContactsInOrganization(input.organizationId, input.contactIds);

    const list = await prisma.contactList.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        members: input.contactIds?.length
          ? {
              create: [...new Set(input.contactIds)].map((contactId) => ({
                contact: { connect: { id: contactId } }
              }))
            }
          : undefined
      },
      include: contactListInclude
    });
    return toResponse(list as unknown as ContactListWithMembers);
  },

  async update(id: string, userId: string, input: ContactListUpdateInput) {
    const existing = await findOwned(id, userId);
    await assertContactsInOrganization(existing.organizationId, input.contactIds);

    return prisma.$transaction(async (tx) => {
      // Replace membership wholesale when contactIds is provided; leave it
      // untouched when omitted (e.g. a rename-only update).
      if (input.contactIds) {
        await tx.contactListMember.deleteMany({ where: { contactListId: id } });
        if (input.contactIds.length) {
          await tx.contactListMember.createMany({
            data: [...new Set(input.contactIds)].map((contactId) => ({
              contactId,
              contactListId: id
            }))
          });
        }
      }

      const updated = await tx.contactList.update({
        where: { id },
        data: { name: input.name, description: input.description },
        include: contactListInclude
      });
      return toResponse(updated as unknown as ContactListWithMembers);
    });
  },

  async delete(id: string, userId: string) {
    await findOwned(id, userId);
    await prisma.contactList.delete({ where: { id } });
  },

  /**
   * Materialize a tag-driven segment into a new list. Members are snapshotted
   * from the current matches and tagged with source SEGMENT. This is a static
   * snapshot — dynamic segments that re-resolve at send time are Phase D.
   */
  async createFromSegment(input: CreateListFromSegmentInput) {
    const contacts = await prisma.contact.findMany({
      where: buildSegmentWhere(input),
      select: { id: true }
    });

    const list = await prisma.contactList.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        members: contacts.length
          ? {
              create: contacts.map((contact) => ({
                contact: { connect: { id: contact.id } },
                source: "SEGMENT" as const
              }))
            }
          : undefined
      },
      include: contactListInclude
    });
    return toResponse(list as unknown as ContactListWithMembers);
  }
};
