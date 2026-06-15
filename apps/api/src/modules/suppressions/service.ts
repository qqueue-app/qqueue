import type { SuppressionReason } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

interface AddSuppressionInput {
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  /** Free-form provenance note (e.g. "webhook", "import", an emailJobId). */
  source?: string;
}

export const suppressionService = {
  list(organizationId: string) {
    return prisma.suppression.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" }
    });
  },

  /**
   * Idempotent insert keyed on the unique (organizationId, email). Re-suppressing
   * an address refreshes its reason/source rather than erroring. Used by the
   * manual endpoint and by bounce/complaint/unsubscribe handling.
   */
  addSuppression(input: AddSuppressionInput) {
    const { organizationId, email, reason, source } = input;
    return prisma.suppression.upsert({
      where: { organizationId_email: { organizationId, email } },
      create: { organizationId, email, reason, source },
      update: { reason, source }
    });
  },

  /** True when the address is on the org's suppression list. */
  async isSuppressed(organizationId: string, email: string) {
    const hit = await prisma.suppression.findUnique({
      where: { organizationId_email: { organizationId, email } },
      select: { id: true }
    });
    return Boolean(hit);
  },

  async remove(id: string, userId: string) {
    const { count } = await prisma.suppression.deleteMany({
      where: { id, organization: { members: { some: { userId } } } }
    });
    if (count === 0) {
      throw new HttpError(404, "Suppression not found");
    }
  }
};
