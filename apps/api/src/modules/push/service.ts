import type {
  InboxNotifyLevel,
  PushRotateInput,
  PushSubscriptionInput,
} from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";

/**
 * Web Push registration. The API only stores and removes subscriptions — the
 * worker is what actually sends, so nothing here needs the private VAPID key.
 *
 * A subscription identifies a *device*, never an organization. Which org's mail
 * may reach that device is `OrganizationMember.notifyLevel`, handled at the
 * bottom of this file.
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
   * Move a registration to the endpoint the browser rotated it to.
   *
   * Authorized by possession of `oldEndpoint` alone — there is no session here.
   * Chrome rotates subscriptions on its own schedule, almost always with no tab
   * open, and the service worker that hears about it cannot read the bearer
   * token from localStorage. The old endpoint is an unguessable URL the push
   * service issued to exactly one client, so proving you hold it is proof you
   * are that client; it is the same reasoning that authorizes unsubscribe links
   * and public image reads.
   *
   * Ownership is *carried over*, never taken from the request: the row keeps the
   * userId it already had, so a replayed rotation cannot move somebody else's
   * device to a new account.
   */
  async rotate(input: PushRotateInput) {
    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint: input.oldEndpoint },
      select: { id: true, userId: true, userAgent: true },
    });

    // Nothing to move. The usual cause is a rotation arriving after the person
    // turned notifications off, which is not an error worth alarming anyone
    // about — but the worker has no row to fix either, so say so plainly.
    if (!existing) {
      throw new HttpError(
        404,
        "That push registration is no longer active",
        "not_found"
      );
    }

    // A rotation whose new endpoint somehow already exists would violate the
    // unique index. Whatever that row was, it is stale by definition: the push
    // service has just told us this endpoint belongs to `existing`.
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: input.endpoint, NOT: { id: existing.id } },
    });

    return prisma.pushSubscription.update({
      where: { id: existing.id },
      data: {
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? existing.userAgent,
        lastUsedAt: new Date(),
      },
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

  /**
   * How much of this org's mail the user wants on their devices. Membership is
   * already verified by the route's org middleware, so a missing row here would
   * be a bug rather than a permission problem — fall back to the schema default
   * instead of failing a settings page over it.
   */
  async getNotifyLevel(
    userId: string,
    organizationId: string
  ): Promise<InboxNotifyLevel> {
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { notifyLevel: true },
    });
    return (membership?.notifyLevel as InboxNotifyLevel | undefined) ?? "ALL";
  },

  async setNotifyLevel(
    userId: string,
    organizationId: string,
    notifyLevel: InboxNotifyLevel
  ): Promise<InboxNotifyLevel> {
    const updated = await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { notifyLevel },
      select: { notifyLevel: true },
    });
    return updated.notifyLevel as InboxNotifyLevel;
  },
};
