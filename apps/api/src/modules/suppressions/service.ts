import {
  type BounceType,
  type SuppressionReason,
  shouldSuppressBounce as decideSuppressBounce
} from "@qqueue/shared";
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
    const { organizationId, reason, source } = input;
    // Stored lowercase so the exact-match lookups downstream are effectively
    // case-insensitive (the migration lowercased existing rows).
    const email = input.email.trim().toLowerCase();
    return prisma.suppression.upsert({
      where: { organizationId_email: { organizationId, email } },
      create: { organizationId, email, reason, source },
      update: { reason, source }
    });
  },

  /** True when the address is on the org's suppression list. */
  async isSuppressed(organizationId: string, email: string) {
    const hit = await prisma.suppression.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email: email.trim().toLowerCase()
        }
      },
      select: { id: true }
    });
    return Boolean(hit);
  },

  /**
   * Which of these addresses are suppressed, as a lowercase Set. One query for
   * callers that need to screen a whole recipient list (manual fan-out).
   */
  async suppressedAmong(
    organizationId: string,
    emails: string[]
  ): Promise<Set<string>> {
    if (emails.length === 0) {
      return new Set();
    }
    const rows = await prisma.suppression.findMany({
      where: {
        organizationId,
        email: { in: emails.map((email) => email.trim().toLowerCase()) }
      },
      select: { email: true }
    });
    return new Set(rows.map((row) => row.email.toLowerCase()));
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
   * Decide whether a bounce should suppress the address now. The decision
   * itself lives in `@qqueue/shared` (`shouldSuppressBounce`); this wrapper
   * supplies the org's effective policy and the soft-bounce event count. Call
   * this AFTER recording the BOUNCED event so the current bounce counts.
   */
  async shouldSuppressBounce(input: {
    organizationId: string;
    email: string;
    bounceType: BounceType;
  }) {
    if (input.bounceType !== "SOFT") {
      return true;
    }
    return decideSuppressBounce({
      bounceType: input.bounceType,
      policy: await this.getEffectivePolicy(input.organizationId),
      countSoftBouncesSince: (windowStart) =>
        prisma.emailEvent.count({
          where: {
            organizationId: input.organizationId,
            type: "BOUNCED",
            occurredAt: { gte: windowStart },
            emailJob: { toEmail: input.email.trim().toLowerCase() },
            metadata: { path: ["bounceType"], equals: "SOFT" }
          }
        })
    });
  }
};
