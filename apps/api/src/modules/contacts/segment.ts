import type { Prisma } from "@prisma/client";
import type { SegmentFilterInput } from "@qqueue/shared";

/**
 * Prisma `where` for a tag-driven segment. `ANY` matches contacts with at least
 * one of the tags (`hasSome`); `ALL` requires every tag (`hasEvery`). An
 * optional status narrows further. Shared by the preview (contacts) and
 * materialize (contact-lists) paths so they always select the same set.
 */
export function buildSegmentWhere(
  input: SegmentFilterInput
): Prisma.ContactWhereInput {
  return {
    organizationId: input.organizationId,
    tags: input.match === "ALL" ? { hasEvery: input.tags } : { hasSome: input.tags },
    ...(input.status ? { status: input.status } : {})
  };
}
