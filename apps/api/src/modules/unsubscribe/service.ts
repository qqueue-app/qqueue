import { prisma } from "../../lib/prisma.js";
import { suppressionService } from "../suppressions/service.js";

export const unsubscribeService = {
  /**
   * Suppress an address org-wide (reason UNSUBSCRIBE) and flip any matching
   * contact to UNSUBSCRIBED. Idempotent: re-unsubscribing is a no-op refresh.
   */
  async unsubscribe(organizationId: string, email: string) {
    await suppressionService.addSuppression({
      organizationId,
      email,
      reason: "UNSUBSCRIBE",
      source: "list-unsubscribe"
    });
    await prisma.contact.updateMany({
      where: { organizationId, email },
      data: { status: "UNSUBSCRIBED" }
    });
  }
};
