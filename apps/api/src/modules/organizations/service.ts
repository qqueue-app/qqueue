import type { OrganizationInput } from "@qqueue/shared";
import { assertOrgAccess, assertOrgRole } from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";

type OrganizationMemberWithOrganization = {
  organization: {
    id: string;
    name: string;
    createdAt: Date;
  };
  role: string;
};

export const organizationService = {
  // Only the organizations the user is a member of, with their role.
  async list(userId: string) {
    const members = await prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { organization: { createdAt: "desc" } }
    });

    return members.map((member: OrganizationMemberWithOrganization) => ({
      id: member.organization.id,
      name: member.organization.name,
      createdAt: member.organization.createdAt,
      role: member.role
    }));
  },

  async get(id: string, userId: string) {
    await assertOrgAccess(userId, id);
    return prisma.organization.findUnique({ where: { id } });
  },

  async listMembers(id: string, userId: string) {
    await assertOrgAccess(userId, id);
    return prisma.organizationMember.findMany({
      where: { organizationId: id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }]
    });
  },

  // Creating an org makes the creator its OWNER, so it's immediately accessible.
  async create(input: OrganizationInput, userId: string) {
    const organization = await prisma.organization.create({
      data: {
        name: input.name,
        members: {
          create: {
            userId,
            role: "OWNER"
          }
        }
      }
    });

    return { ...organization, role: "OWNER" as const };
  },

  async update(id: string, userId: string, input: OrganizationInput) {
    await assertOrgRole(userId, id, ["OWNER", "ADMIN"]);
    return prisma.organization.update({
      where: { id },
      data: input
    });
  },

  async delete(id: string, userId: string) {
    await assertOrgRole(userId, id, ["OWNER"]);
    await prisma.organization.delete({ where: { id } });
  }
};
