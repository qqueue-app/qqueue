import { randomBytes } from "node:crypto";
import type {
  MailboxAdoptInput,
  MailboxAdoptResult,
  MailboxDeleteResult,
  MailboxPasswordResetResult,
  MailboxProvisionInput,
  MailboxProvisionResult,
  MailboxSummary,
  MailcowStatus,
} from "@qqueue/shared";
import { env } from "../../config/env.js";
import { encryptSecret } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { getMembership } from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";
import {
  normalizeDefault,
  smtpConnectionSelect,
  verifyConnection,
} from "../smtp-connections/service.js";
import {
  getMailcowClient,
  mailcowMailHost,
  type MailcowClient,
} from "./client.js";

/**
 * Mailbox provisioning (Phase 4): an OWNER/ADMIN creates a team mailbox from
 * QQueue. One flow yields the Mailcow mailbox, an app password held only by
 * QQueue, the SMTPConnection, the sync-enabled InboxAccount (mandatory — it
 * is what gives DSN parsing bounce visibility for this identity), and
 * optionally a send-as grant. Members never touch SMTP credentials or the
 * Mailcow UI; they read mail with the mailbox password in their own client.
 */

function generatePassword() {
  // 24 random bytes -> 32 base64url chars: length + mixed classes satisfies
  // Mailcow's default policy without ever needing human recall.
  return randomBytes(24).toString("base64url");
}

// Post-provision verification probe. Mailcow can take a moment to activate a
// fresh mailbox/app password, so a failed handshake right after creation is
// ambiguous — retry briefly, and report the outcome instead of failing the
// provisioning (rollback is reserved for "we couldn't record what we
// created", never "the SMTP handshake didn't work yet"). Short per-attempt
// timeout so the worst case (unreachable host) can't stall the request.
const VERIFY_PROBE_TIMEOUT_MS = 6_000;
const VERIFY_PROBE_DELAYS_MS = [0, 2_000, 5_000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Domain access (per-role): an OWNER may provision under any active Mailcow
 * domain; an ADMIN only under domains an owner granted them (default deny).
 * The route already restricts callers to OWNER/ADMIN.
 */
async function visibleDomains(
  actor: { organizationId: string; userId: string; role: string },
  activeDomains: string[]
): Promise<string[]> {
  if (actor.role === "OWNER") {
    return activeDomains;
  }
  const grants = await prisma.mailDomainGrant.findMany({
    where: { organizationId: actor.organizationId, userId: actor.userId },
    select: { domain: true },
  });
  const granted = new Set(grants.map((grant) => grant.domain));
  return activeDomains.filter((domain) => granted.has(domain.toLowerCase()));
}

/**
 * Domain access for a *mutating* action, the enforcement half of
 * `visibleDomains`. An OWNER may act on any domain the server offers; an ADMIN
 * only on granted ones (default deny).
 */
async function assertDomainAccess(
  actor: { organizationId: string; userId: string; role: string },
  domain: string,
  verb: string
): Promise<void> {
  if (actor.role === "OWNER") {
    return;
  }
  const grant = await prisma.mailDomainGrant.findUnique({
    where: {
      organizationId_userId_domain: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        domain,
      },
    },
    select: { id: true },
  });
  if (!grant) {
    throw new HttpError(
      403,
      `You do not have access to ${verb} mailboxes on this domain`,
      "domain_not_granted"
    );
  }
}

/** The configured client, or a 404 explaining that provisioning is off. */
function requireClient(): MailcowClient {
  const client = getMailcowClient();
  if (!client) {
    throw new HttpError(
      404,
      "Mailcow provisioning is not configured on this instance",
      "mailcow_not_configured"
    );
  }
  return client;
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Resolve the target of a mailbox action: the caller must have domain access
 * *and* the mailbox must actually exist on the server. Without the existence
 * check an admin could aim a reset or a delete at any address they can spell.
 */
async function resolveManageableMailbox(
  client: MailcowClient,
  actor: { organizationId: string; userId: string; role: string },
  email: string,
  verb: string
) {
  const domain = domainOf(email);
  if (!domain) {
    throw new HttpError(400, "That is not a valid address", "validation_error");
  }
  await assertDomainAccess(actor, domain, verb);

  const mailbox = (await client.listMailboxes(domain)).find(
    (candidate) => candidate.email === email
  );
  if (!mailbox) {
    throw new HttpError(
      404,
      `${email} does not exist on the mail server`,
      "not_found"
    );
  }
  return mailbox;
}

async function probeProvisionedConnection(connection: {
  host: string;
  port: number;
  secure: boolean;
  usernameEncrypted: string;
  passwordEncrypted: string;
}): Promise<boolean> {
  for (const delay of VERIFY_PROBE_DELAYS_MS) {
    if (delay > 0) {
      await sleep(delay);
    }
    try {
      await verifyConnection(connection, VERIFY_PROBE_TIMEOUT_MS);
      return true;
    } catch {
      // Try again after the next delay; the caller surfaces the final state.
    }
  }
  return false;
}

/**
 * Take custody of a mail-server mailbox: mint an app password, record the
 * SMTPConnection and the sync-enabled InboxAccount, optionally grant send-as,
 * then probe the credentials.
 *
 * Shared by provisioning (which creates the mailbox first) and adoption (which
 * finds one already there), so both arrive at exactly the same end state — one
 * mailbox that QQueue can send from and read replies for.
 */
async function connectMailbox(
  client: MailcowClient,
  input: {
    organizationId: string;
    email: string;
    mailHost: string;
    name?: string;
    assignToUserId?: string;
  }
) {
  const { organizationId, email, mailHost } = input;
  const appPassword = generatePassword();

  await client.createAppPassword({
    email,
    name: "QQueue",
    password: appPassword,
  });

  const usernameEncrypted = encryptSecret(email);
  const passwordEncrypted = encryptSecret(appPassword);

  const created = await prisma.$transaction(async (tx) => {
    const isDefault = await normalizeDefault(organizationId, undefined, tx);
    const connection = await tx.sMTPConnection.create({
      data: {
        organizationId,
        name: input.name ?? email,
        host: mailHost,
        port: env.MAILCOW_SMTP_PORT,
        secure: true,
        usernameEncrypted,
        passwordEncrypted,
        fromEmail: email,
        fromName: input.name,
        isDefault,
      },
      select: smtpConnectionSelect,
    });
    const inbox = await tx.inboxAccount.create({
      data: {
        organizationId,
        name: input.name ?? email,
        email,
        host: mailHost,
        port: env.MAILCOW_IMAP_PORT,
        secure: true,
        usernameEncrypted,
        passwordEncrypted,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (input.assignToUserId) {
      await tx.smtpConnectionGrant.create({
        data: {
          organizationId,
          smtpConnectionId: connection.id,
          userId: input.assignToUserId,
        },
      });
    }
    return { connection, inbox };
  });

  // Non-fatal: everything is created and recorded; this only tells the admin
  // whether the credentials already work end to end.
  const verified = await probeProvisionedConnection({
    host: mailHost,
    port: env.MAILCOW_SMTP_PORT,
    secure: true,
    usernameEncrypted,
    passwordEncrypted,
  });

  return {
    smtpConnection: {
      ...created.connection,
      createdAt: created.connection.createdAt.toISOString(),
      updatedAt: created.connection.updatedAt.toISOString(),
    } as MailboxProvisionResult["smtpConnection"],
    inboxAccountId: created.inbox.id,
    verified,
  };
}

/** Reject an address QQueue already holds credentials for. */
async function assertNotAlreadyConnected(
  organizationId: string,
  email: string
): Promise<void> {
  const existingInbox = await prisma.inboxAccount.findUnique({
    where: { organizationId_email: { organizationId, email } },
    select: { id: true },
  });
  if (existingInbox) {
    throw new HttpError(
      409,
      `${email} is already connected to this organization`,
      "conflict"
    );
  }
}

export const mailcowService = {
  /** Instance provisioning status + the domains a mailbox can live under. */
  async status(actor: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<MailcowStatus> {
    const client = getMailcowClient();
    const mailHost = mailcowMailHost();
    if (!client) {
      return { configured: false, reachable: false, domains: [], mailHost };
    }
    try {
      const domains = await client.listDomains();
      const active = domains
        .filter((domain) => domain.active)
        .map((domain) => domain.domain_name);
      const visible = await visibleDomains(actor, active);
      return {
        configured: true,
        reachable: true,
        domains: visible,
        mailHost,
        ...(visible.length !== active.length ? { restricted: true } : {}),
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        domains: [],
        mailHost,
        error:
          error instanceof Error ? error.message : "Unable to reach Mailcow",
      };
    }
  },

  /**
   * Every mailbox on the caller's domains, from both sides at once: the mail
   * server's inventory merged with QQueue's own sending accounts.
   *
   * This is deliberately not "the SMTPConnection list". A mailbox created in
   * the Mailcow UI is real mail that arrives whether or not QQueue knows about
   * it, so the page has to show it — tagged SERVER_ONLY and offered for
   * adoption — rather than pretending the domain is empty.
   */
  async listMailboxes(actor: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<MailboxSummary[]> {
    const connections = await prisma.sMTPConnection.findMany({
      where: { organizationId: actor.organizationId },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        fromEmail: true,
        fromName: true,
        isDefault: true,
      },
      orderBy: [{ fromEmail: "asc" }, { createdAt: "asc" }],
    });

    const client = getMailcowClient();
    let serverMailboxes: Awaited<ReturnType<MailcowClient["listMailboxes"]>> =
      [];
    if (client) {
      try {
        const domains = await client.listDomains();
        const active = domains
          .filter((domain) => domain.active)
          .map((domain) => domain.domain_name);
        const visible = new Set(
          (await visibleDomains(actor, active)).map((domain) =>
            domain.toLowerCase()
          )
        );
        serverMailboxes = (await client.listMailboxes()).filter((mailbox) =>
          visible.has(domainOf(mailbox.email))
        );
      } catch {
        // Mail server unreachable or misconfigured: fall through with the
        // sending accounts QQueue already knows, so the page keeps working in
        // read-only terms. `status()` is what reports the outage itself.
      }
    }

    const rows: MailboxSummary[] = [];
    const serverRowByEmail = new Map<string, MailboxSummary>();

    for (const mailbox of serverMailboxes) {
      const row: MailboxSummary = {
        email: mailbox.email,
        domain: domainOf(mailbox.email),
        name: mailbox.name,
        origin: "SERVER_ONLY",
        active: mailbox.active,
        quotaBytes: mailbox.quotaBytes,
        usedBytes: mailbox.usedBytes,
        smtpConnectionId: null,
        host: null,
        port: null,
        isDefault: false,
      };
      serverRowByEmail.set(row.email, row);
      rows.push(row);
    }

    for (const connection of connections) {
      const email = connection.fromEmail.toLowerCase();
      const server = serverRowByEmail.get(email);
      // Only the first connection claims a server mailbox; a second one for
      // the same address is a distinct sending identity and gets its own row
      // rather than silently vanishing from the list.
      if (server && server.smtpConnectionId === null) {
        server.origin = "MANAGED";
        server.smtpConnectionId = connection.id;
        server.host = connection.host;
        server.port = connection.port;
        server.isDefault = connection.isDefault;
        server.name =
          server.name || connection.fromName || connection.name || email;
        continue;
      }
      // No server match. Either it lives somewhere else entirely (a hand-added
      // SES/Postmark account), or it sits on a domain this ADMIN was not
      // granted — they can still send as it, they just cannot administer the
      // mailbox behind it.
      rows.push({
        email,
        domain: domainOf(email),
        name: connection.fromName || connection.name || email,
        origin: "EXTERNAL",
        active: null,
        quotaBytes: null,
        usedBytes: null,
        smtpConnectionId: connection.id,
        host: connection.host,
        port: connection.port,
        isDefault: connection.isDefault,
      });
    }

    return rows.sort((a, b) => a.email.localeCompare(b.email));
  },

  async provision(
    input: MailboxProvisionInput,
    actor: { userId: string; role: string }
  ): Promise<MailboxProvisionResult> {
    const client = requireClient();
    const mailHost = mailcowMailHost();
    if (!mailHost) {
      throw new HttpError(
        404,
        "Mailcow provisioning is not configured on this instance",
        "mailcow_not_configured"
      );
    }

    const localPart = input.localPart.toLowerCase();
    const domain = input.domain.toLowerCase();
    const email = `${localPart}@${domain}`;

    // Everything that can fail cheaply fails before Mailcow is mutated.
    const domains = await client.listDomains();
    if (
      !domains.some(
        (candidate) =>
          candidate.active && candidate.domain_name.toLowerCase() === domain
      )
    ) {
      throw new HttpError(
        400,
        `${domain} is not an active domain on the Mailcow server`,
        "validation_error"
      );
    }

    // Domain access: OWNERs may use any domain; an ADMIN needs a grant. The
    // filtered status keeps the UI honest, but this is the enforcement.
    await assertDomainAccess(
      { ...actor, organizationId: input.organizationId },
      domain,
      "provision"
    );

    if (input.assignToUserId) {
      const granteeMembership = await getMembership(
        input.assignToUserId,
        input.organizationId
      );
      if (!granteeMembership) {
        throw new HttpError(
          400,
          "The assignee is not a member of this organization",
          "validation_error"
        );
      }
    }

    await assertNotAlreadyConnected(input.organizationId, email);

    const mailboxPassword = generatePassword();

    await client.createMailbox({
      localPart,
      domain,
      name: input.name,
      password: mailboxPassword,
    });

    try {
      const connected = await connectMailbox(client, {
        organizationId: input.organizationId,
        email,
        mailHost,
        name: input.name,
        assignToUserId: input.assignToUserId,
      });
      return { ...connected, email, mailboxPassword };
    } catch (error) {
      // The mailbox exists in Mailcow but QQueue's side failed: delete it so
      // provisioning never leaves an orphan that the next attempt trips over.
      // Cleanup is best-effort — the original error is the one that matters.
      await client.deleteMailbox(email).catch((cleanupError) => {
        console.error(
          `[mailcow] provisioning failed for ${email} and cleanup also failed — delete the mailbox in Mailcow by hand`,
          cleanupError
        );
      });
      throw error;
    }
  },

  /**
   * Connect a mailbox that already exists on the mail server. The back half of
   * `provision` minus the mailbox creation — and, crucially, minus the
   * rollback: this mailbox predates QQueue and is not ours to delete just
   * because our own bookkeeping failed.
   */
  async adopt(
    input: MailboxAdoptInput,
    actor: { userId: string; role: string }
  ): Promise<MailboxAdoptResult> {
    const client = requireClient();
    const mailHost = mailcowMailHost();
    if (!mailHost) {
      throw new HttpError(
        404,
        "Mailcow provisioning is not configured on this instance",
        "mailcow_not_configured"
      );
    }

    const email = input.email.toLowerCase();
    const scoped = { ...actor, organizationId: input.organizationId };
    const mailbox = await resolveManageableMailbox(
      client,
      scoped,
      email,
      "manage"
    );

    if (input.assignToUserId) {
      const granteeMembership = await getMembership(
        input.assignToUserId,
        input.organizationId
      );
      if (!granteeMembership) {
        throw new HttpError(
          400,
          "The assignee is not a member of this organization",
          "validation_error"
        );
      }
    }

    await assertNotAlreadyConnected(input.organizationId, email);

    const connected = await connectMailbox(client, {
      organizationId: input.organizationId,
      email,
      mailHost,
      name: input.name ?? mailbox.name ?? undefined,
      assignToUserId: input.assignToUserId,
    });

    return { ...connected, email };
  },

  /**
   * Rotate the human's mailbox password. Safe for delivery: QQueue sends with
   * a separate app password, so this touches neither the SMTPConnection nor
   * the inbox sync — only whoever reads the mailbox in a mail client.
   */
  async resetPassword(
    input: { organizationId: string; email: string },
    actor: { userId: string; role: string }
  ): Promise<MailboxPasswordResetResult> {
    const client = requireClient();
    const email = input.email.toLowerCase();
    await resolveManageableMailbox(
      client,
      { ...actor, organizationId: input.organizationId },
      email,
      "manage"
    );

    const mailboxPassword = generatePassword();
    await client.setMailboxPassword(email, mailboxPassword);
    return { email, mailboxPassword };
  },

  /** Pause or resume delivery to a mailbox without destroying anything. */
  async setActive(
    input: { organizationId: string; email: string; active: boolean },
    actor: { userId: string; role: string }
  ): Promise<{ email: string; active: boolean }> {
    const client = requireClient();
    const email = input.email.toLowerCase();
    await resolveManageableMailbox(
      client,
      { ...actor, organizationId: input.organizationId },
      email,
      "manage"
    );

    await client.setMailboxActive(email, input.active);
    return { email, active: input.active };
  },

  /**
   * Delete the mailbox on the mail server and clean up QQueue's side.
   *
   * Order matters: the server goes first, because a failed database step after
   * a successful delete leaves recoverable bookkeeping, whereas tearing down
   * our records before a delete that then fails would strip access to a
   * mailbox that is still live.
   *
   * The InboxAccount is disabled rather than deleted — `InboundMessage`
   * cascades from it, so deleting would destroy every message already synced
   * out of a mailbox that no longer exists to re-sync from. The SMTPConnection
   * does go: it is a sending identity with no mailbox behind it, and
   * `EmailJob.smtpConnectionId` is SetNull, so send history survives.
   */
  async remove(
    input: { organizationId: string; email: string },
    actor: { userId: string; role: string }
  ): Promise<MailboxDeleteResult> {
    const client = requireClient();
    const email = input.email.toLowerCase();
    await resolveManageableMailbox(
      client,
      { ...actor, organizationId: input.organizationId },
      email,
      "delete"
    );

    await client.deleteMailbox(email);

    const [connections, inboxes] = await Promise.all([
      prisma.sMTPConnection.deleteMany({
        where: { organizationId: input.organizationId, fromEmail: email },
      }),
      prisma.inboxAccount.updateMany({
        where: { organizationId: input.organizationId, email },
        data: { status: "DISABLED" },
      }),
    ]);

    return {
      email,
      smtpConnectionDeleted: connections.count > 0,
      inboxAccountDisabled: inboxes.count > 0,
    };
  },

  // Domain-grant management. Routes restrict all three to org OWNERs — the
  // grant is what separates an ADMIN's provisioning reach from an OWNER's,
  // so admins must not be able to grant themselves.

  listDomainGrants(organizationId: string) {
    return prisma.mailDomainGrant.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: [{ userId: "asc" }, { domain: "asc" }],
    });
  },

  async addDomainGrant(input: {
    organizationId: string;
    userId: string;
    domain: string;
  }) {
    const domain = input.domain.trim().toLowerCase();

    const granteeMembership = await getMembership(
      input.userId,
      input.organizationId
    );
    if (!granteeMembership) {
      throw new HttpError(
        400,
        "That user is not a member of this organization",
        "validation_error"
      );
    }

    // Only real, active Mailcow domains are grantable — a typo here would
    // silently grant nothing.
    const client = getMailcowClient();
    if (!client) {
      throw new HttpError(
        404,
        "Mailcow provisioning is not configured on this instance",
        "mailcow_not_configured"
      );
    }
    const domains = await client.listDomains();
    if (
      !domains.some(
        (candidate) =>
          candidate.active && candidate.domain_name.toLowerCase() === domain
      )
    ) {
      throw new HttpError(
        400,
        `${domain} is not an active domain on the Mailcow server`,
        "validation_error"
      );
    }

    // Idempotent: re-granting is a no-op rather than an error.
    return prisma.mailDomainGrant.upsert({
      where: {
        organizationId_userId_domain: {
          organizationId: input.organizationId,
          userId: input.userId,
          domain,
        },
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        domain,
      },
      update: {},
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  },

  async removeDomainGrant(id: string, organizationId: string) {
    await prisma.mailDomainGrant.deleteMany({
      where: { id, organizationId },
    });
  },
};
