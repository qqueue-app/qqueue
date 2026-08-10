import webpush from "web-push";
import {
  mailboxDomain,
  resolveInboxNotify,
  type PushNotificationPayload,
} from "@qqueue/shared";
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

export interface PushRecipient {
  userId: string;
  payload: PushNotificationPayload;
}

/**
 * Send to every device belonging to each named user.
 *
 * The payload is per-recipient rather than shared, because two people can need
 * different words for the same event: someone who belongs to several orgs needs
 * to be told which one this is, and someone who belongs to one would only find
 * that noise.
 *
 * Returns how many pushes the push services accepted — "accepted" is as far as
 * we can ever know, since actual display is the device's decision.
 */
export async function sendPushToUsers(
  recipients: PushRecipient[]
): Promise<number> {
  if (!ensureConfigured()) return 0;
  if (recipients.length === 0) return 0;

  const payloadByUser = new Map(
    recipients.map((recipient) => [recipient.userId, recipient.payload])
  );

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: [...payloadByUser.keys()] } },
    select: { id: true, endpoint: true, p256dh: true, auth: true, userId: true },
  });

  if (subscriptions.length === 0) return 0;

  const results = await Promise.all(
    subscriptions.map((subscription) => {
      const payload = payloadByUser.get(subscription.userId);
      // Can't happen — the query filtered on these ids — but a missing payload
      // must never become a `JSON.stringify(undefined)` sent to a device.
      if (!payload) return Promise.resolve(false);
      return deliver(subscription, JSON.stringify(payload));
    })
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

export interface InboundMessageNotification {
  organizationId: string;
  /** The mailbox it arrived at — only people granted it are told. */
  inboxAccountId: string;
  /** That mailbox's address, for matching per-domain notification rules. */
  inboxAccountEmail: string;
  /** Stored message id, used for the deep link. */
  messageId: string;
  /** Sender, already formatted for display. */
  sender: string;
  subject: string;
  /** Collapses replies on one conversation into a single banner. */
  threadKey: string;
  /** Everyone the message was addressed to, for `ADDRESSED_TO_ME`. */
  recipientEmails: string[];
}

/**
 * Notify the members of an org who asked to hear about new mail.
 *
 * Three filters, applied in this order, and the order is the safety property:
 *
 * 1. **Access.** A member is told about mail in a mailbox they hold; an
 *    OWNER/ADMIN about any of them. Without this, a banner carrying sender and
 *    subject would be the one way to read a mailbox you were never given — and
 *    it would reach the device of someone the inbox itself refuses.
 * 2. **Which mailbox** (`InboxNotifyRule`). Per-mailbox and per-domain mutes
 *    the member set for themselves. Because access ran first, a rule covering a
 *    whole domain still only ever silences the mailboxes they could already
 *    read; nothing here can widen the audience.
 * 3. **Which mail within it** (`notifyLevel`). `NONE` is silence, `ALL` is
 *    every message, and `ADDRESSED_TO_ME` limits it to mail with that person in
 *    To/Cc — useful when members add their own addresses as separate inbox
 *    accounts, useless on a shared support@ box, which is why it is not the
 *    default.
 */
export async function notifyNewInboundMessage(
  notification: InboundMessageNotification
): Promise<number> {
  if (!ensureConfigured()) return 0;

  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: notification.organizationId,
      notifyLevel: { not: "NONE" },
      OR: [
        { role: { in: ["OWNER", "ADMIN"] } },
        {
          user: {
            inboxGrants: {
              some: { inboxAccountId: notification.inboxAccountId },
            },
          },
        },
      ],
    },
    select: {
      userId: true,
      notifyLevel: true,
      user: { select: { email: true } },
    },
  });

  if (members.length === 0) return 0;

  // Only the rules that could bear on *this* mailbox, for the people already
  // through the access filter. One query for the whole audience.
  const domain = mailboxDomain(notification.inboxAccountEmail);
  const rules = await prisma.inboxNotifyRule.findMany({
    where: {
      organizationId: notification.organizationId,
      userId: { in: members.map((member) => member.userId) },
      OR: [
        { scope: "MAILBOX", inboxAccountId: notification.inboxAccountId },
        { scope: "DOMAIN", domain },
      ],
    },
    select: {
      userId: true,
      scope: true,
      domain: true,
      inboxAccountId: true,
      enabled: true,
    },
  });

  const rulesByUser = new Map<string, typeof rules>();
  for (const rule of rules) {
    const existing = rulesByUser.get(rule.userId);
    if (existing) existing.push(rule);
    else rulesByUser.set(rule.userId, [rule]);
  }

  const addressed = new Set(
    notification.recipientEmails.map((email) => email.trim().toLowerCase())
  );
  const interested = members.filter((member) => {
    // Absent rules resolve to on: someone who never opened the settings page,
    // or was granted this mailbox after they last did, still hears about it.
    const { enabled } = resolveInboxNotify(rulesByUser.get(member.userId) ?? [], {
      inboxAccountId: notification.inboxAccountId,
      domain,
    });
    if (!enabled) return false;

    return (
      member.notifyLevel === "ALL" ||
      addressed.has(member.user.email.trim().toLowerCase())
    );
  });

  if (interested.length === 0) return 0;

  const userIds = interested.map((member) => member.userId);

  // Which of them belong to more than one org, and so need to be told which org
  // this banner is about. One query for the whole set rather than one each.
  const [organization, memberships] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: notification.organizationId },
      select: { name: true },
    }),
    prisma.organizationMember.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
    }),
  ]);

  const orgCount = new Map<string, number>();
  for (const membership of memberships) {
    orgCount.set(membership.userId, (orgCount.get(membership.userId) ?? 0) + 1);
  }

  const subject = truncateForNotification(
    notification.subject || "(no subject)"
  );
  // The org has to travel in the link as well as the banner: a device serving
  // two orgs would otherwise open the message in whichever org the app happened
  // to have selected, and find nothing.
  const url = `/inbox?org=${encodeURIComponent(
    notification.organizationId
  )}&message=${encodeURIComponent(notification.messageId)}`;

  return sendPushToUsers(
    interested.map((member) => {
      const multiOrg = (orgCount.get(member.userId) ?? 1) > 1;
      return {
        userId: member.userId,
        payload: {
          title: notification.sender,
          body:
            multiOrg && organization?.name
              ? `${subject} · ${organization.name}`
              : subject,
          url,
          tag: `inbox:${notification.threadKey}`,
        },
      };
    })
  );
}

/** Trim a subject or preview to something a notification banner can show. */
export function truncateForNotification(value: string, max = 120): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}
