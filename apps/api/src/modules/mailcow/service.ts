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
  MailDomainCreateInput,
  MailDomainDeleteInput,
  MailDomainDeleteResult,
  MailDomainDnsStatus,
  MailDomainSummary,
  MailDomainUpdateInput,
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
import { buildDnsRecords, checkDnsRecords, detectDnsProvider } from "./dns.js";

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
 * Which of the server's domains this *organization* may act on at all.
 *
 * Mailcow domains are instance-global but the Mailboxes page is org-scoped, so
 * an org reaches a domain only when it claims it (`OrgMailDomain`) or when no
 * org has. The unclaimed case is what keeps a single-org self-hosted instance
 * behaving exactly as it did before ownership existed; on a multi-org instance
 * it is the pool an owner claims from, not a hole — a claimed domain is
 * invisible to every other org from here on.
 */
async function orgDomainScope(
  organizationId: string,
  activeDomains: string[]
): Promise<{ visible: string[]; claimed: Set<string> }> {
  const rows = await prisma.orgMailDomain.findMany({
    where: { domain: { in: activeDomains.map((d) => d.toLowerCase()) } },
    select: { domain: true, organizationId: true },
  });
  const ownerByDomain = new Map(
    rows.map((row) => [row.domain, row.organizationId])
  );
  const claimed = new Set(
    rows
      .filter((row) => row.organizationId === organizationId)
      .map((row) => row.domain)
  );
  const visible = activeDomains.filter((domain) => {
    const owner = ownerByDomain.get(domain.toLowerCase());
    return owner === undefined || owner === organizationId;
  });
  return { visible, claimed };
}

/**
 * Domain access (per-role): an OWNER may provision under any domain the org
 * reaches; an ADMIN only under domains an owner granted them (default deny).
 * The route already restricts callers to OWNER/ADMIN.
 */
async function visibleDomains(
  actor: { organizationId: string; userId: string; role: string },
  activeDomains: string[]
): Promise<string[]> {
  const { visible } = await orgDomainScope(actor.organizationId, activeDomains);
  if (actor.role === "OWNER") {
    return visible;
  }
  const grants = await prisma.mailDomainGrant.findMany({
    where: { organizationId: actor.organizationId, userId: actor.userId },
    select: { domain: true },
  });
  const granted = new Set(grants.map((grant) => grant.domain));
  // A grant never widens the org's own reach — it narrows within it.
  return visible.filter((domain) => granted.has(domain.toLowerCase()));
}

/**
 * Domain access for a *mutating* action, the enforcement half of
 * `visibleDomains`. An OWNER may act on any domain the org reaches; an ADMIN
 * only on granted ones (default deny).
 */
async function assertDomainAccess(
  actor: { organizationId: string; userId: string; role: string },
  domain: string,
  verb: string
): Promise<void> {
  // Applies to every role: a domain another org has claimed is not ours to
  // touch, however senior the caller is inside their own org.
  const owner = await prisma.orgMailDomain.findUnique({
    where: { domain },
    select: { organizationId: true },
  });
  if (owner && owner.organizationId !== actor.organizationId) {
    throw new HttpError(
      403,
      `${domain} belongs to another organization on this instance`,
      "domain_not_granted"
    );
  }

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

/** The mail host every provisioned identity and DNS record points at. */
function requireMailHost(): string {
  const mailHost = mailcowMailHost();
  if (!mailHost) {
    throw new HttpError(
      404,
      "Mailcow provisioning is not configured on this instance",
      "mailcow_not_configured"
    );
  }
  return mailHost;
}

/**
 * The domain must exist on the server before we act on it. Mailcow answers an
 * unknown domain by doing nothing rather than erroring, so without this an
 * edit or a DNS check on a typo would report cheerful success.
 */
async function assertDomainExists(
  client: MailcowClient,
  domain: string
): Promise<void> {
  const domains = await client.listDomains();
  if (!domains.some((candidate) => candidate.domain_name === domain)) {
    throw new HttpError(
      404,
      `${domain} does not exist on the mail server`,
      "not_found"
    );
  }
}

/**
 * Build a domain's DNS picture, without re-checking that the domain exists.
 *
 * Split out from `dnsStatus` for the creation path specifically. Going back
 * through the guarded entry point would re-list the server's domains, and a
 * Mailcow that has not yet surfaced the domain we just created would 404 a
 * creation that actually succeeded — leaving the domain and its claim in place
 * while the caller is told it failed.
 */
async function buildDnsStatus(
  client: MailcowClient,
  domain: string,
  mailHost: string
): Promise<MailDomainDnsStatus> {
  const dkim = await client.getDkim(domain).catch(() => null);
  const records = buildDnsRecords({ domain, mailHost, dkim });

  const [detected, checked] = await Promise.all([
    detectDnsProvider(domain),
    checkDnsRecords(records),
  ]);

  return {
    domain,
    mailHost,
    provider: detected.provider,
    nameservers: detected.nameservers,
    records: checked,
    ready: checked
      .filter((record) => record.required)
      .every((record) => record.status === "OK"),
  };
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

  // Domain management. Routes restrict every one of these to org OWNERs:
  // creating a domain changes the shared mail server, and claiming one decides
  // which org reaches it, so neither is an ADMIN's call to make.

  /**
   * Domains on the mail server this org may act on, with the server's own
   * numbers attached. Unclaimed domains are included and labelled, because an
   * owner cannot claim what the page refuses to show them.
   */
  async listDomains(actor: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<MailDomainSummary[]> {
    const client = requireClient();
    const domains = await client.listDomains();
    const { visible, claimed } = await orgDomainScope(
      actor.organizationId,
      domains.map((domain) => domain.domain_name)
    );
    const visibleSet = new Set(visible.map((domain) => domain.toLowerCase()));

    // One DKIM read per visible domain, concurrently. Mailcow has no bulk
    // endpoint for it, and the flag is what tells an owner whether their mail
    // is being signed at all.
    const rows = await Promise.all(
      domains
        .filter((domain) => visibleSet.has(domain.domain_name))
        .map(async (domain): Promise<MailDomainSummary> => {
          const hasDkim = await client
            .getDkim(domain.domain_name)
            .then((key) => key !== null)
            // A failed DKIM read must not blank the whole list; the domain's
            // own DNS panel reports the real state.
            .catch(() => false);
          return {
            domain: domain.domain_name,
            ownership: claimed.has(domain.domain_name)
              ? "CLAIMED"
              : "UNCLAIMED",
            active: domain.active,
            description: domain.description,
            mailboxCount: domain.mailboxCount,
            maxMailboxes: domain.maxMailboxes,
            defaultQuotaBytes: domain.defaultQuotaBytes,
            maxQuotaBytes: domain.maxQuotaBytes,
            backupmx: domain.backupmx,
            hasDkim,
          };
        })
    );

    return rows.sort((a, b) => a.domain.localeCompare(b.domain));
  },

  /**
   * Create a domain on the mail server and claim it for this org.
   *
   * DKIM is generated as part of creation rather than left for later: Mailcow
   * signs with the key from the moment it exists, so generating it now is what
   * lets the DNS panel show the complete record set in one pass, instead of
   * sending the owner back to publish another record days later.
   *
   * Takes no actor, unlike its siblings: a domain that does not exist yet has
   * no per-domain access to check. The route restricts this to OWNERs, and the
   * "claimed by another org" guard below is the rest of the answer.
   */
  async createDomain(
    input: MailDomainCreateInput
  ): Promise<{ domain: MailDomainSummary; dns: MailDomainDnsStatus }> {
    const client = requireClient();
    const mailHost = requireMailHost();
    const domain = input.domain;

    const existing = await client.listDomains();
    if (existing.some((candidate) => candidate.domain_name === domain)) {
      throw new HttpError(
        409,
        `${domain} already exists on the mail server`,
        "conflict"
      );
    }

    // "Claimed by another org" is a different answer from "already exists",
    // and the owner needs to be able to tell them apart.
    const claimedElsewhere = await prisma.orgMailDomain.findUnique({
      where: { domain },
      select: { organizationId: true },
    });
    if (
      claimedElsewhere &&
      claimedElsewhere.organizationId !== input.organizationId
    ) {
      throw new HttpError(
        409,
        `${domain} is claimed by another organization on this instance`,
        "conflict"
      );
    }

    await client.createDomain(domain, {
      description: input.description,
      maxMailboxes: input.maxMailboxes,
      defaultQuotaMiB: input.defaultQuotaMiB,
      maxQuotaMiB: input.maxQuotaMiB,
      totalQuotaMiB: input.totalQuotaMiB,
      active: input.active,
    });

    try {
      if (input.generateDkim) {
        // Non-fatal: a domain without DKIM still delivers, just unsigned, and
        // the DNS panel offers to generate the key on demand.
        await client.generateDkim(domain).catch((error) => {
          console.error(
            `[mailcow] created ${domain} but DKIM generation failed`,
            error
          );
        });
      }

      await prisma.orgMailDomain.create({
        data: { domain, organizationId: input.organizationId },
      });
    } catch (error) {
      // The domain exists on the server but QQueue could not record who owns
      // it. Leaving it would make it unclaimed — and so visible to every org
      // on the instance — so undo the creation. Cleanup is best-effort; the
      // original error is the one that matters.
      await client.deleteDomain(domain).catch((cleanupError) => {
        console.error(
          `[mailcow] failed to record ownership of ${domain} and cleanup also failed — delete the domain in Mailcow by hand`,
          cleanupError
        );
      });
      throw error;
    }

    // Built directly rather than through dnsStatus/listDomains: both re-list
    // the server's domains to guard themselves, and a Mailcow that hasn't yet
    // surfaced the domain we just created would fail a creation that worked.
    const dns = await buildDnsStatus(client, domain, mailHost);

    return {
      domain: {
        domain,
        ownership: "CLAIMED",
        active: input.active !== false,
        description: input.description ?? "",
        mailboxCount: 0,
        maxMailboxes: input.maxMailboxes ?? 0,
        defaultQuotaBytes: 0,
        maxQuotaBytes: 0,
        backupmx: false,
        // Authoritative: this is what Mailcow actually holds a moment later,
        // not what we asked for — DKIM generation is allowed to have failed.
        hasDkim: dns.records.some((record) => record.key === "dkim"),
      },
      dns,
    };
  },

  /** Edit a domain's description, limits or active flag. The name is fixed. */
  async updateDomain(
    input: MailDomainUpdateInput,
    actor: { userId: string; role: string }
  ): Promise<MailDomainSummary> {
    const client = requireClient();
    const domain = input.domain;
    const scoped = { ...actor, organizationId: input.organizationId };

    await assertDomainAccess(scoped, domain, "manage");
    await assertDomainExists(client, domain);

    await client.updateDomain(domain, {
      description: input.description,
      maxMailboxes: input.maxMailboxes,
      defaultQuotaMiB: input.defaultQuotaMiB,
      maxQuotaMiB: input.maxQuotaMiB,
      totalQuotaMiB: input.totalQuotaMiB,
      active: input.active,
    });

    const rows = await mailcowService.listDomains(scoped);
    const updated = rows.find((row) => row.domain === domain);
    if (!updated) {
      throw new HttpError(404, `${domain} is no longer visible`, "not_found");
    }
    return updated;
  },

  /**
   * Claim an unclaimed server domain for this org.
   *
   * The path for domains that predate QQueue or were created in the Mailcow
   * UI. Claiming makes the domain invisible to every other org, so the unique
   * constraint on `OrgMailDomain.domain` — not this read — is what actually
   * settles two orgs racing for the same one.
   */
  async claimDomain(
    input: { organizationId: string; domain: string },
    actor: { userId: string; role: string }
  ): Promise<MailDomainSummary> {
    const client = requireClient();
    const domain = input.domain.trim().toLowerCase();
    const scoped = { ...actor, organizationId: input.organizationId };

    await assertDomainExists(client, domain);

    const existing = await prisma.orgMailDomain.findUnique({
      where: { domain },
      select: { organizationId: true },
    });
    if (existing && existing.organizationId !== input.organizationId) {
      throw new HttpError(
        409,
        `${domain} is already claimed by another organization`,
        "conflict"
      );
    }
    if (!existing) {
      await prisma.orgMailDomain.create({
        data: { domain, organizationId: input.organizationId },
      });
    }

    const rows = await mailcowService.listDomains(scoped);
    const claimed = rows.find((row) => row.domain === domain);
    if (!claimed) {
      throw new HttpError(404, `${domain} is no longer visible`, "not_found");
    }
    return claimed;
  },

  /**
   * Delete a domain from the mail server.
   *
   * Refused while any mailbox still exists on it. Mailcow would happily delete
   * the domain and every mailbox, alias and message under it in one call, and
   * that is far too much to hang on a single button — emptying the domain
   * first makes the blast radius something the owner has already seen.
   */
  async deleteDomain(
    input: MailDomainDeleteInput,
    actor: { userId: string; role: string }
  ): Promise<MailDomainDeleteResult> {
    const client = requireClient();
    const domain = input.domain;
    const scoped = { ...actor, organizationId: input.organizationId };

    if (input.confirm !== domain) {
      throw new HttpError(
        400,
        "Type the domain name exactly to confirm deletion",
        "validation_error"
      );
    }

    await assertDomainAccess(scoped, domain, "delete");
    await assertDomainExists(client, domain);

    const mailboxes = await client.listMailboxes(domain);
    if (mailboxes.length > 0) {
      throw new HttpError(
        409,
        `${domain} still has ${mailboxes.length} mailbox${
          mailboxes.length === 1 ? "" : "es"
        }. Delete those first — removing the domain would destroy every message in them.`,
        "conflict"
      );
    }

    await client.deleteDomain(domain);

    // Same ordering rule as mailbox removal: the server goes first, so a
    // failure afterwards leaves recoverable bookkeeping rather than stripping
    // access to something still live. Inbox accounts are disabled rather than
    // deleted, because InboundMessage cascades from them.
    const suffix = `@${domain}`;
    const [connections, inboxes] = await prisma.$transaction([
      prisma.sMTPConnection.deleteMany({
        where: {
          organizationId: input.organizationId,
          fromEmail: { endsWith: suffix, mode: "insensitive" },
        },
      }),
      prisma.inboxAccount.updateMany({
        where: {
          organizationId: input.organizationId,
          email: { endsWith: suffix, mode: "insensitive" },
        },
        data: { status: "DISABLED" },
      }),
      prisma.mailDomainGrant.deleteMany({
        where: { organizationId: input.organizationId, domain },
      }),
      prisma.orgMailDomain.deleteMany({
        where: { organizationId: input.organizationId, domain },
      }),
    ]);

    return {
      domain,
      smtpConnectionsDeleted: connections.count,
      inboxAccountsDisabled: inboxes.count,
    };
  },

  /**
   * What this domain needs in DNS, and how much of it is live.
   *
   * Read-only and advisory: a lookup can fail without failing the request,
   * because "we could not check" and "the record is missing" are different
   * answers and only one of them is the owner's problem.
   */
  async dnsStatus(
    input: { organizationId: string; domain: string },
    actor: { userId: string; role: string }
  ): Promise<MailDomainDnsStatus> {
    const client = requireClient();
    const mailHost = requireMailHost();
    const domain = input.domain.trim().toLowerCase();
    const scoped = { ...actor, organizationId: input.organizationId };

    await assertDomainAccess(scoped, domain, "manage");
    await assertDomainExists(client, domain);

    return buildDnsStatus(client, domain, mailHost);
  },

  /**
   * Generate a DKIM key for a domain that has none.
   *
   * Never a rotation: Mailcow starts signing with the new key immediately, so
   * replacing a key whose record is already published would break every
   * signature until DNS caught up. Rotation stays in Mailcow, deliberately.
   */
  async generateDkim(
    input: { organizationId: string; domain: string },
    actor: { userId: string; role: string }
  ): Promise<MailDomainDnsStatus> {
    const client = requireClient();
    const domain = input.domain.trim().toLowerCase();
    const scoped = { ...actor, organizationId: input.organizationId };

    await assertDomainAccess(scoped, domain, "manage");
    await assertDomainExists(client, domain);

    const existing = await client.getDkim(domain).catch(() => null);
    if (existing) {
      throw new HttpError(
        409,
        `${domain} already has a DKIM key. Rotate it in Mailcow if you mean to replace it.`,
        "conflict"
      );
    }

    await client.generateDkim(domain);
    return mailcowService.dnsStatus(
      { organizationId: input.organizationId, domain },
      actor
    );
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
