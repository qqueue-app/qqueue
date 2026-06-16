import type { Prisma } from "@prisma/client";
import {
  type SegmentInput,
  type SegmentPreviewInput,
  type SegmentRule,
  type SegmentUpdateInput,
  compileSegmentRules
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Prisma `where` for a segment within an org. The compiled rule tree is ANDed
 * with the org scope. Pass `activeOnly` at send time to also exclude
 * unsubscribed/bounced contacts.
 */
export function segmentContactWhere(
  organizationId: string,
  rules: SegmentRule,
  options: { activeOnly?: boolean } = {}
): Prisma.ContactWhereInput {
  return {
    organizationId,
    ...(options.activeOnly ? { status: "ACTIVE" } : {}),
    ...(compileSegmentRules(rules) as Prisma.ContactWhereInput)
  };
}

async function findOwned(id: string, userId: string) {
  const segment = await prisma.segment.findFirst({
    where: { id, organization: { members: { some: { userId } } } }
  });
  if (!segment) {
    throw new HttpError(404, "Segment not found");
  }
  return segment;
}

export const segmentService = {
  list(organizationId: string) {
    return prisma.segment.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" }
    });
  },

  get(id: string, userId: string) {
    return findOwned(id, userId);
  },

  create(input: SegmentInput) {
    return prisma.segment.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        rules: input.rules
      }
    });
  },

  async update(id: string, userId: string, input: SegmentUpdateInput) {
    await findOwned(id, userId);
    return prisma.segment.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        rules: input.rules
      }
    });
  },

  async remove(id: string, userId: string) {
    await findOwned(id, userId);
    await prisma.segment.delete({ where: { id } });
  },

  /** Live count + a small sample of the contacts a rule tree currently matches. */
  async preview(input: SegmentPreviewInput) {
    const where = segmentContactWhere(input.organizationId, input.rules);
    const [count, sample] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({ where, take: 10, orderBy: { createdAt: "asc" } })
    ]);
    return { count, sample };
  }
};
