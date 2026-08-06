import webpush from "web-push";
import type { PushNotificationPayload } from "@qqueue/shared";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

let configured: boolean | null = null;

/**
 * Configure web-push once, lazily. Push is optional: an instance with no VAPID
 * pair simply never notifies, and every call here becomes a no-op rather than
 * an error — notifications are a convenience layered on the inbox, not a step
 * in the delivery pipeline.
 */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    logger.info("web push disabled: VAPID keys are not configured");
    configured = false;
    return false;
  }

  try {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY
    );
    configured = true;
  } catch (error) {
    // A malformed key pair is a configuration mistake, not a runtime fault:
    // say so once and carry on without push.
    logger.error({ err: error }, "invalid VAPID configuration; push disabled");
    configured = false;
  }

  return configured;
}

export function pushEnabled(): boolean {
  return ensureConfigured();
}

/**
 * A push service answering 404 or 410 means the client unsubscribed or the app
 * was uninstalled. That registration is dead forever, so the row is deleted
 * rather than retried — otherwise every later send re-attempts a corpse.
 */
async function deliver(
  subscription: {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  },
  payload: string
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      { TTL: 60 * 60 }
    );
    return true;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushSubscription
        .delete({ where: { id: subscription.id } })
        .catch(() => undefined);
      logger.info(
        { subscriptionId: subscription.id },
        "removed expired push subscription"
      );
      return false;
    }
    logger.warn(
      { subscriptionId: subscription.id, statusCode, err: error },
      "push delivery failed"
    );
    return false;
  }
}

export interface SendPushOptions {
  organizationId: string;
  payload: PushNotificationPayload;
  /** Restrict delivery to specific users; omit to notify the whole org. */
  userIds?: string[];
}

/**
 * Notify an organization's registered devices. Returns how many pushes the
 * push services accepted — "accepted" is as far as we can ever know, since
 * actual display is the device's decision.
 */
export async function sendPushToOrganization({
  organizationId,
  payload,
  userIds,
}: SendPushOptions): Promise<number> {
  if (!ensureConfigured()) return 0;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      organizationId,
      ...(userIds?.length ? { userId: { in: userIds } } : {}),
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subscriptions.length === 0) return 0;

  const body = JSON.stringify(payload);
  const results = await Promise.all(
    subscriptions.map((subscription) => deliver(subscription, body))
  );
  const delivered = results.filter(Boolean).length;

  if (delivered > 0) {
    await prisma.pushSubscription
      .updateMany({
        where: { id: { in: subscriptions.map((s) => s.id) } },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }

  return delivered;
}

/** Trim a subject or preview to something a notification banner can show. */
export function truncateForNotification(value: string, max = 120): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}
