import type { BounceType, SuppressionReason } from "@qqueue/shared";
import { env } from "../../config/env.js";
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
  },

  /**
   * The org's effective auto-suppression policy: its row when present, otherwise
   * the env-provided defaults.
   */
  async getEffectivePolicy(organizationId: string) {
    const row = await prisma.suppressionPolicy.findUnique({
      where: { organizationId }
    });
    return {
      organizationId,
      softBounceThreshold:
        row?.softBounceThreshold ?? env.SOFT_BOUNCE_THRESHOLD,
      softBounceWindowDays:
        row?.softBounceWindowDays ?? env.SOFT_BOUNCE_WINDOW_DAYS
    };
  },

  upsertPolicy(input: {
    organizationId: string;
    softBounceThreshold: number;
    softBounceWindowDays: number;
  }) {
    const { organizationId, softBounceThreshold, softBounceWindowDays } = input;
    return prisma.suppressionPolicy.upsert({
      where: { organizationId },
      create: { organizationId, softBounceThreshold, softBounceWindowDays },
      update: { softBounceThreshold, softBounceWindowDays }
    });
  },

  /**
   * Decide whether a bounce should suppress the address now. Hard bounces and
   * blocks suppress immediately; a soft bounce only suppresses once the org's
   * soft-bounce count for the address within the window reaches the threshold.
   * Call this AFTER recording the BOUNCED event so the current bounce counts.
   */
  async shouldSuppressBounce(input: {
    organizationId: string;
    email: string;
    bounceType: BounceType;
  }) {
    if (input.bounceType !== "SOFT") {
      return true;
    }
    const { softBounceThreshold, softBounceWindowDays } =
      await this.getEffectivePolicy(input.organizationId);
    const windowStart = new Date(
      Date.now() - softBounceWindowDays * 24 * 60 * 60 * 1000
    );
    const softCount = await prisma.emailEvent.count({
      where: {
        organizationId: input.organizationId,
        type: "BOUNCED",
        occurredAt: { gte: windowStart },
        emailJob: { toEmail: input.email },
        metadata: { path: ["bounceType"], equals: "SOFT" }
      }
    });
    return softCount >= softBounceThreshold;
  }
};
