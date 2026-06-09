import type { UserRole } from "@qqueue/shared";
import { HttpError } from "./http-error.js";
import { prisma } from "./prisma.js";

/**
 * Resolve a user's membership in an organization, or null if they are not a
 * member. This is the single source of truth for the org boundary.
 */
export function getMembership(userId: string, organizationId: string) {
  return prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } }
  });
}

/**
 * Assert the user belongs to the organization, returning their membership.
 * Throws 403 otherwise.
 */
export async function assertOrgAccess(userId: string, organizationId: string) {
  const membership = await getMembership(userId, organizationId);
  if (!membership) {
    throw new HttpError(403, "You do not have access to this organization");
  }
  return membership;
}

/**
 * Assert the user has one of the given roles in the organization.
 */
export async function assertOrgRole(
  userId: string,
  organizationId: string,
  roles: UserRole[]
) {
  const membership = await assertOrgAccess(userId, organizationId);
  if (!roles.includes(membership.role as UserRole)) {
    throw new HttpError(403, "You do not have permission to do this");
  }
  return membership;
}
