import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { prisma } from "../../lib/prisma.js";

interface UpsertInput {
  organizationId: string;
  domain: string;
  maxPerMinute: number;
}

export const domainThrottleService = {
  list(organizationId: string) {
    return prisma.domainThrottle.findMany({
      where: { organizationId },
      orderBy: [{ domain: "asc" }]
    });
  },

  /** The env fallback applied when no row matches a domain or the default. */
  defaultPerMinute() {
    return env.DEFAULT_DOMAIN_MAX_PER_MINUTE;
  },

  /** Idempotent upsert on (organizationId, domain). domain "" is the default. */
  upsert(input: UpsertInput) {
    const { organizationId, domain, maxPerMinute } = input;
    return prisma.domainThrottle.upsert({
      where: { organizationId_domain: { organizationId, domain } },
      create: { organizationId, domain, maxPerMinute },
      update: { maxPerMinute }
    });
  },

  async remove(id: string, userId: string) {
    const { count } = await prisma.domainThrottle.deleteMany({
      where: { id, organization: { members: { some: { userId } } } }
    });
    if (count === 0) {
      throw new HttpError(404, "Domain throttle not found");
    }
  }
};
