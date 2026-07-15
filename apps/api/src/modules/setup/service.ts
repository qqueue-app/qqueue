import type { SetupCompleteInput, SetupStatus } from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  getInstanceSettings,
  setInstanceSettings
} from "../../lib/instance-settings.js";
import { prisma } from "../../lib/prisma.js";

export const setupService = {
  /**
   * Public first-run probe. `needsSetup` gates the whole app into the /setup
   * wizard on a fresh install; `setupCompleted` is the softer resume signal
   * (the wizard finished, vs. an admin exists but bailed mid-wizard).
   */
  async status(): Promise<SetupStatus> {
    const userCount = await prisma.user.count();
    const needsSetup = userCount === 0;
    const settings = await getInstanceSettings();

    return {
      needsSetup,
      setupCompleted: settings.setupCompletedAt !== null,
      // Effective value: while the instance has no users at all, registration
      // is always open (bootstrap exception), whatever the stored flag says.
      allowPublicRegistration: needsSetup
        ? true
        : settings.allowPublicRegistration
    };
  },

  async complete(userId: string, input: SetupCompleteInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isInstanceAdmin: true }
    });
    if (!user?.isInstanceAdmin) {
      throw new HttpError(
        403,
        "Only an instance administrator can complete setup"
      );
    }

    const settings = await getInstanceSettings();
    if (settings.setupCompletedAt !== null) {
      throw new HttpError(409, "Setup is already complete");
    }

    const setupCompletedAt = new Date().toISOString();
    await setInstanceSettings({
      allowPublicRegistration: input.allowPublicRegistration,
      setupCompletedAt
    });

    return { setupCompletedAt };
  }
};
