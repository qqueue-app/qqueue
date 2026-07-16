import type { OrganizationInput, UserRole } from "@qqueue/shared";
import {
  assertOrgAccess,
  assertOrgRole,
  getMembership
} from "../../lib/org-access.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

const memberUserSelect = {
  id: true,
  email: true,
  name: true
};

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
  },

  // Change a member's role. Guardrails: OWNER/ADMIN only; an ADMIN may not touch
  // an OWNER; only an OWNER may grant the OWNER role; and the last remaining
  // OWNER can never be demoted (an org must always have an owner).
  async updateMemberRole(
    organizationId: string,
    targetUserId: string,
    actorUserId: string,
    role: UserRole
  ) {
    const actor = await assertOrgRole(actorUserId, organizationId, [
      "OWNER",
      "ADMIN"
    ]);

    const target = await getMembership(targetUserId, organizationId);
    if (!target) {
      throw new HttpError(404, "Member not found in this organization");
    }

    if (actor.role === "ADMIN" && target.role === "OWNER") {
      throw new HttpError(403, "Admins cannot change an owner's role");
    }

    if (role === "OWNER" && actor.role !== "OWNER") {
      throw new HttpError(403, "Only an owner can grant the owner role");
    }

    if (target.role === "OWNER" && role !== "OWNER") {
      await assertNotLastOwner(organizationId);
    }

    return prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      data: { role },
      include: { user: { select: memberUserSelect } }
    });
  },

  // Remove a member. Guardrails mirror role changes: OWNER/ADMIN only; an ADMIN
  // may not remove an OWNER; and the last remaining OWNER can never be removed.
  async removeMember(
    organizationId: string,
    targetUserId: string,
    actorUserId: string
  ) {
    const actor = await assertOrgRole(actorUserId, organizationId, [
      "OWNER",
      "ADMIN"
    ]);

    const target = await getMembership(targetUserId, organizationId);
    if (!target) {
      throw new HttpError(404, "Member not found in this organization");
    }

    if (actor.role === "ADMIN" && target.role === "OWNER") {
      throw new HttpError(403, "Admins cannot remove an owner");
    }

    if (target.role === "OWNER") {
      await assertNotLastOwner(organizationId);
    }

    await prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId, userId: targetUserId } }
    });
  }
};

// Reject an operation that would leave an organization with no OWNER.
async function assertNotLastOwner(organizationId: string) {
  const ownerCount = await prisma.organizationMember.count({
    where: { organizationId, role: "OWNER" }
  });
  if (ownerCount <= 1) {
    throw new HttpError(400, "An organization must always have at least one owner");
  }
}
