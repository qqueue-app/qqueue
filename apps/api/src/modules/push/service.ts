import {
  mailboxDomain,
  resolveInboxNotify,
  type InboxNotifyDomainGroup,
  type InboxNotifyLevel,
  type InboxNotifyRuleUpdateInput,
  type InboxNotifySettings,
  type PushRotateInput,
  type PushSubscriptionInput,
} from "@qqueue/shared";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import { resolveMailboxAccess } from "../../lib/mailbox-access.js";

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

  /**
   * The notification settings page, in one response: the org-wide level, then
   * every mailbox the caller can read, grouped by domain.
   *
   * The mailbox list comes from their *access*, so the page can only ever offer
   * what the inbox itself would show them. A domain with ten addresses on it
   * appears here holding the one they hold — which is why the domain switch is
   * safe to describe as "everything on acme.test" without it meaning more than
   * they were given.
   */
  async getNotifySettings(
    userId: string,
    organizationId: string
  ): Promise<InboxNotifySettings> {
    const access = await resolveMailboxAccess(userId, organizationId);

    const [notifyLevel, accounts, rules] = await Promise.all([
      this.getNotifyLevel(userId, organizationId),
      prisma.inboxAccount.findMany({
        where: {
          organizationId,
          ...(access.unrestricted
            ? {}
            : { id: { in: access.inboxAccountIds } }),
        },
        select: { id: true, name: true, email: true },
      }),
      prisma.inboxNotifyRule.findMany({
        where: { organizationId, userId },
        select: {
          scope: true,
          domain: true,
          inboxAccountId: true,
          enabled: true,
        },
      }),
    ]);

    const byDomain = new Map<string, InboxNotifyDomainGroup>();
    for (const account of accounts) {
      const domain = mailboxDomain(account.email);
      const { enabled, explicit } = resolveInboxNotify(rules, {
        inboxAccountId: account.id,
        domain,
      });

      const group = byDomain.get(domain) ?? {
        domain,
        state: "ALL" as const,
        mailboxes: [],
      };
      group.mailboxes.push({
        inboxAccountId: account.id,
        email: account.email,
        name: account.name,
        enabled,
        explicit,
      });
      byDomain.set(domain, group);
    }

    const domains = [...byDomain.values()]
      .map((group) => ({
        ...group,
        // Derived rather than read off the domain rule: a domain switched on
        // with one mailbox muted underneath is honestly "some", and a switch
        // reading "all" over an unticked row is the kind of small lie that
        // makes people stop trusting the page.
        state: group.mailboxes.every((mailbox) => mailbox.enabled)
          ? ("ALL" as const)
          : group.mailboxes.some((mailbox) => mailbox.enabled)
            ? ("SOME" as const)
            : ("NONE" as const),
        mailboxes: group.mailboxes.sort((a, b) =>
          a.email.localeCompare(b.email)
        ),
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return { organizationId, notifyLevel, domains };
  },

  /**
   * Turn one mailbox — or one domain's worth of them — on or off.
   *
   * Rows are written only where they disagree with the level above them, and
   * deleted the moment they agree again. So re-ticking a mailbox inside an
   * otherwise-default domain removes its row rather than storing `true`, and
   * the mailbox goes back to following the default forever, including through
   * a later change to its domain. Storing every answer would instead freeze
   * today's default into a row nobody remembers setting.
   *
   * Switching a domain clears the per-mailbox exceptions beneath it: the person
   * has just answered the broader question, and leaving contradicting ticks
   * behind would make the switch appear not to have worked.
   */
  async setNotifyRule(
    userId: string,
    input: InboxNotifyRuleUpdateInput
  ): Promise<InboxNotifySettings> {
    const { organizationId, enabled, target } = input;
    const access = await resolveMailboxAccess(userId, organizationId);

    if (target.scope === "MAILBOX") {
      // Verified against access, not just against the org: a rule naming a
      // mailbox somebody cannot read is at best dead weight, and writing it
      // would let the settings page imply an access it does not have.
      const account = await prisma.inboxAccount.findFirst({
        where: {
          id: target.inboxAccountId,
          organizationId,
          ...(access.unrestricted
            ? {}
            : { id: { in: access.inboxAccountIds } }),
        },
        select: { id: true, email: true },
      });
      if (!account) {
        throw new HttpError(
          404,
          "That mailbox isn't one you have access to",
          "not_found"
        );
      }

      // What this mailbox would do with no rule of its own — its domain rule,
      // or the default. Matching it means the row has nothing to say.
      const domain = mailboxDomain(account.email);
      const domainRule = await prisma.inboxNotifyRule.findFirst({
        where: { organizationId, userId, scope: "DOMAIN", domain },
        select: { enabled: true },
      });
      const inherited = domainRule?.enabled ?? true;

      if (inherited === enabled) {
        await prisma.inboxNotifyRule.deleteMany({
          where: { userId, inboxAccountId: account.id },
        });
      } else {
        await prisma.inboxNotifyRule.upsert({
          where: {
            userId_inboxAccountId: { userId, inboxAccountId: account.id },
          },
          create: {
            organizationId,
            userId,
            scope: "MAILBOX",
            inboxAccountId: account.id,
            enabled,
          },
          update: { enabled },
        });
      }

      return this.getNotifySettings(userId, organizationId);
    }

    const domain = target.domain.trim().toLowerCase();
    const accounts = await prisma.inboxAccount.findMany({
      where: {
        organizationId,
        ...(access.unrestricted ? {} : { id: { in: access.inboxAccountIds } }),
      },
      select: { id: true, email: true },
    });
    const onDomain = accounts.filter(
      (account) => mailboxDomain(account.email) === domain
    );
    if (onDomain.length === 0) {
      throw new HttpError(
        404,
        "You have no mailboxes on that domain",
        "not_found"
      );
    }

    await prisma.$transaction(async (tx) => {
      // The broader answer supersedes the narrower ones.
      await tx.inboxNotifyRule.deleteMany({
        where: {
          userId,
          inboxAccountId: { in: onDomain.map((account) => account.id) },
        },
      });

      if (enabled) {
        // On *is* the default, so the domain needs no row — and having none is
        // what lets a mailbox added to this domain next month notify.
        await tx.inboxNotifyRule.deleteMany({
          where: { organizationId, userId, scope: "DOMAIN", domain },
        });
        return;
      }

      await tx.inboxNotifyRule.upsert({
        where: {
          userId_organizationId_domain: { userId, organizationId, domain },
        },
        create: {
          organizationId,
          userId,
          scope: "DOMAIN",
          domain,
          enabled: false,
        },
        update: { enabled: false },
      });
    });

    return this.getNotifySettings(userId, organizationId);
  },
};
