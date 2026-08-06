import type { PushSubscriptionInput } from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";

/**
 * Web Push registration. The API only stores and removes subscriptions — the
 * worker is what actually sends, so nothing here needs the private VAPID key.
 */
export const pushService = {
  /**
   * The public half of the VAPID pair, or null when push is not configured.
   * The dashboard uses null to mean "hide the enable-notifications control"
   * rather than prompting for a permission it could never act on.
   */
  publicKey(): string | null {
    return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? env.VAPID_PUBLIC_KEY
      : null;
  },

  /**
   * Register (or re-register) one client. Browsers recycle an endpoint after a
   * permission reset and may hand the same endpoint to a different user on a
   * shared device, so the upsert reassigns ownership rather than assuming the
   * existing row still belongs to whoever created it.
   */
  async subscribe(userId: string, input: PushSubscriptionInput) {
    const data = {
      userId,
      organizationId: input.organizationId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
      lastUsedAt: new Date(),
    };

    return prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
      select: { id: true, endpoint: true, createdAt: true },
    });
  },

  /**
   * Remove one client's registration. Scoped to the user so one account cannot
   * silence another's device by guessing an endpoint. Deleting something that
   * is already gone is success — the caller wanted it gone.
   */
  async unsubscribe(userId: string, endpoint: string) {
    await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  },

  /** The user's registered devices, for the settings list. */
  async listForUser(userId: string) {
    return prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  },
};
