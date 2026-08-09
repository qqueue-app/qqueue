import type {
  InstanceAdminMute,
  InstanceMailDomainCreateInput,
  InstanceMailDomainDeleteInput,
  InstanceMailDomainGrantCreateInput,
  InstanceMailDomainSummary,
  InstanceMailDomainUpdateInput,
  InstanceMailboxSummary,
  InstanceMuteCreateInput,
  InstanceMuteScope,
  InstanceOrganizationDetail,
  InstanceOrganizationSummary,
  MailDomainAssignee,
  MailDomainAssignInput,
  MailDomainDeleteResult,
  MailDomainDnsStatus,
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { getMembership } from "../../lib/org-access.js";
import { prisma } from "../../lib/prisma.js";
import { getMailcowClient } from "../mailcow/client.js";
import {
  assertDomainExists,
  buildDnsStatus,
  domainOf,
  requireClient,
  requireMailHost,
} from "../mailcow/service.js";

/**
 * Instance administration — the install-scope view of the whole server.
 *
 * Mail domains are instance-global: one Mailcow API key, one mail server,
 * shared by every org on the install. They used to be gated on org OWNER,
 * which is not an instance-level permission — `POST /organizations` is ungated,
 * so any user could create an org, become its OWNER, and from there reach the
 * shared server. Domain and grant management therefore live here, behind
 * `User.isInstanceAdmin`, and an org reaches a domain only once an
 * administrator assigns it (`OrgMailDomain`).
 *
 * Scope is deliberately the *infrastructure* layer: organizations, members,
 * domains, mailboxes, sending accounts and send volume. Never message bodies,
 * contacts or campaign content. Nothing here calls `requireOrgMembership` or
 * synthesizes a membership — the org boundary in `lib/org-access.ts` stays
 * absolute, and these endpoints simply are not org-scoped. That is what keeps
 * "runs the mail server" from quietly becoming "reads everyone's mail".
 */

/** Trailing window for the per-org send counts. Counts only, never content. */
const STATS_WINDOW_DAYS = 30;

/** This admin's mutes, as lookup sets. Personal and cosmetic — never access. */
async function loadMutes(userId: string): Promise<{
  orgs: Set<string>;
  domains: Set<string>;
}> {
  const rows = await prisma.instanceAdminMute.findMany({
    where: { userId },
    select: { scope: true, target: true },
  });
  return {
    orgs: new Set(
      rows.filter((row) => row.scope === "ORG").map((row) => row.target)
    ),
    domains: new Set(
      rows
        .filter((row) => row.scope === "DOMAIN")
        .map((row) => row.target.toLowerCase())
    ),
  };
}

/**
 * Domain -> every org assigned to it, for the whole instance.
 *
 * A list rather than a single owner: a domain may be handed to several orgs at
 * once. Sorted by name so the UI's badges do not reshuffle between refetches.
 */
async function assignmentsByDomain(): Promise<
  Map<string, MailDomainAssignee[]>
> {
  const rows = await prisma.orgMailDomain.findMany({
    select: {
      domain: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
    orderBy: { organization: { name: "asc" } },
  });
  const map = new Map<string, MailDomainAssignee[]>();
  for (const row of rows) {
    const key = row.domain.toLowerCase();
    const list = map.get(key) ?? [];
    list.push({ id: row.organizationId, name: row.organization.name });
    map.set(key, list);
  }
  return map;
}

/**
 * Turn requested org ids into real orgs, rejecting the whole call on the first
 * unknown one. All-or-nothing on purpose: silently dropping an id an
 * administrator ticked would report success for an assignment that never
 * happened.
 */
async function resolveOrganizations(
  organizationIds: string[]
): Promise<MailDomainAssignee[]> {
  if (organizationIds.length === 0) {
    return [];
  }
  const rows = await prisma.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (rows.length !== organizationIds.length) {
    throw new HttpError(
      400,
      "One of those organizations does not exist",
      "validation_error"
    );
  }
  return rows;
}

export const instanceAdminService = {
  /* ---------------------------------------------------------------- orgs */

  /**
   * Every organization on the instance.
   *
   * Muted orgs are still returned, flagged rather than dropped: the caller
   * renders them behind an "including N muted" affordance. A list that silently
   * omitted rows would make a cosmetic filter look like missing data.
   */
  async listOrganizations(
    userId: string
  ): Promise<InstanceOrganizationSummary[]> {
    const [organizations, mutes] = await Promise.all([
      prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: {
            select: {
              members: true,
              orgMailDomains: true,
              smtpConnections: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      loadMutes(userId),
    ]);

    return organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      memberCount: organization._count.members,
      domainCount: organization._count.orgMailDomains,
      sendingAccountCount: organization._count.smtpConnections,
      createdAt: organization.createdAt.toISOString(),
      muted: mutes.orgs.has(organization.id),
    }));
  },

  /** One organization in full — membership, holdings, and send volume. */
  async getOrganization(
    id: string,
    userId: string
  ): Promise<InstanceOrganizationDetail> {
    const organization = await prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        members: {
          select: {
            role: true,
            createdAt: true,
            user: { select: { id: true, email: true, name: true } },
          },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        },
        orgMailDomains: { select: { domain: true }, orderBy: { domain: "asc" } },
        smtpConnections: {
          select: { id: true, name: true, fromEmail: true, isDefault: true },
          orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        },
      },
    });

    if (!organization) {
      throw new HttpError(404, "Organization not found", "not_found");
    }

    const since = new Date(
      Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    const grouped = await prisma.emailJob.groupBy({
      by: ["status"],
      where: { organizationId: id, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const countFor = (status: string) =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;

    const mutes = await loadMutes(userId);

    return {
      id: organization.id,
      name: organization.name,
      memberCount: organization.members.length,
      domainCount: organization.orgMailDomains.length,
      sendingAccountCount: organization.smtpConnections.length,
      createdAt: organization.createdAt.toISOString(),
      muted: mutes.orgs.has(organization.id),
      members: organization.members.map((member) => ({
        id: member.user.id,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
        joinedAt: member.createdAt.toISOString(),
      })),
      domains: organization.orgMailDomains.map((row) => row.domain),
      sendingAccounts: organization.smtpConnections,
      stats: {
        sent: countFor("SENT"),
        failed: countFor("FAILED"),
        // occurredAt, not createdAt — and the (organizationId, type,
        // occurredAt) index covers this shape exactly.
        bounced: await prisma.emailEvent.count({
          where: {
            organizationId: id,
            type: "BOUNCED",
            occurredAt: { gte: since },
          },
        }),
        suppressed: countFor("SUPPRESSED"),
      },
    };
  },

  /* ------------------------------------------------------------- domains */

  /**
   * Every domain on the mail server, with the org it is assigned to.
   *
   * The instance view has no "unclaimed pool" problem to solve, so unlike the
   * org-scoped scope helper it lists everything and names the holder.
   */
  async listDomains(userId: string): Promise<InstanceMailDomainSummary[]> {
    const client = requireClient();
    const [domains, assignments, mutes] = await Promise.all([
      client.listDomains(),
      assignmentsByDomain(),
      loadMutes(userId),
    ]);

    // One DKIM read per domain, concurrently — Mailcow has no bulk endpoint,
    // and the flag is what says whether mail from it is signed at all.
    const rows = await Promise.all(
      domains.map(async (domain): Promise<InstanceMailDomainSummary> => {
        const hasDkim = await client
          .getDkim(domain.domain_name)
          .then((key) => key !== null)
          // A failed read must not blank the list; the domain's own DNS panel
          // reports the real state.
          .catch(() => false);
        const assigned = assignments.get(domain.domain_name.toLowerCase()) ?? [];
        return {
          domain: domain.domain_name,
          ownership: assigned.length > 0 ? "CLAIMED" : "UNCLAIMED",
          organizations: assigned,
          active: domain.active,
          description: domain.description,
          mailboxCount: domain.mailboxCount,
          maxMailboxes: domain.maxMailboxes,
          defaultQuotaBytes: domain.defaultQuotaBytes,
          maxQuotaBytes: domain.maxQuotaBytes,
          backupmx: domain.backupmx,
          hasDkim,
          muted: mutes.domains.has(domain.domain_name.toLowerCase()),
        };
      })
    );

    return rows.sort((a, b) => a.domain.localeCompare(b.domain));
  },

  /**
   * Create a domain on the mail server, optionally assigning it at once.
   *
   * DKIM is generated as part of creation rather than left for later: Mailcow
   * signs with the key from the moment it exists, so generating it now is what
   * lets the DNS panel show the complete record set in one pass, instead of
   * sending the administrator back to publish another record days later.
   *
   * Unlike the old org-scoped version this needs no rollback for a failed
   * ownership write: an unassigned domain now reaches nobody, so a domain left
   * on the server without an `OrgMailDomain` row is inert rather than exposed.
   */
  async createDomain(
    input: InstanceMailDomainCreateInput
  ): Promise<{ domain: InstanceMailDomainSummary; dns: MailDomainDnsStatus }> {
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

    const organizationIds = [...new Set(input.organizationIds ?? [])];
    const organizations = await resolveOrganizations(organizationIds);

    await client.createDomain(domain, {
      description: input.description,
      maxMailboxes: input.maxMailboxes,
      defaultQuotaMiB: input.defaultQuotaMiB,
      maxQuotaMiB: input.maxQuotaMiB,
      totalQuotaMiB: input.totalQuotaMiB,
      active: input.active,
    });

    if (input.generateDkim) {
      // Non-fatal: a domain without DKIM still delivers, just unsigned, and the
      // DNS panel offers to generate the key on demand.
      await client.generateDkim(domain).catch((error) => {
        console.error(
          `[instance-admin] created ${domain} but DKIM generation failed`,
          error
        );
      });
    }

    if (organizations.length > 0) {
      await prisma.orgMailDomain.createMany({
        data: organizations.map((organization) => ({
          domain,
          organizationId: organization.id,
        })),
      });
    }

    // Built directly rather than through dnsStatus/listDomains: both re-list
    // the server's domains to guard themselves, and a Mailcow that hasn't yet
    // surfaced the domain we just created would fail a creation that worked.
    const dns = await buildDnsStatus(client, domain, mailHost);

    return {
      domain: {
        domain,
        ownership: organizations.length > 0 ? "CLAIMED" : "UNCLAIMED",
        organizations,
        active: input.active !== false,
        description: input.description ?? "",
        mailboxCount: 0,
        maxMailboxes: input.maxMailboxes ?? 0,
        defaultQuotaBytes: 0,
        maxQuotaBytes: 0,
        backupmx: false,
        // Authoritative: what Mailcow actually holds a moment later, not what
        // we asked for — DKIM generation is allowed to have failed.
        hasDkim: dns.records.some((record) => record.key === "dkim"),
      },
      dns,
    };
  },

  /** Edit a domain's description, limits or active flag. The name is fixed. */
  async updateDomain(
    input: InstanceMailDomainUpdateInput,
    userId: string
  ): Promise<InstanceMailDomainSummary> {
    const client = requireClient();
    const domain = input.domain;

    await assertDomainExists(client, domain);
    await client.updateDomain(domain, {
      description: input.description,
      maxMailboxes: input.maxMailboxes,
      defaultQuotaMiB: input.defaultQuotaMiB,
      maxQuotaMiB: input.maxQuotaMiB,
      totalQuotaMiB: input.totalQuotaMiB,
      active: input.active,
    });

    const rows = await instanceAdminService.listDomains(userId);
    const updated = rows.find((row) => row.domain === domain);
    if (!updated) {
      throw new HttpError(
        404,
        `${domain} is no longer on the mail server`,
        "not_found"
      );
    }
    return updated;
  },

  /**
   * Set which organizations reach a domain.
   *
   * Replaces the old self-serve claim, and takes the complete desired set
   * rather than a delta — a checkbox list submits the whole set, so one call
   * both adds and removes and re-submitting the same set changes nothing. An
   * empty array hands the domain back to the instance, where it reaches nobody.
   *
   * Orgs dropped from the set lose their grants for the domain too: a grant is
   * delegation *within* an assignment and cannot outlive it. Orgs that stay
   * keep theirs, which is the whole reason this diffs rather than clearing and
   * rewriting — a no-op re-submit must not quietly revoke delegations.
   */
  async assignDomain(
    domain: string,
    input: MailDomainAssignInput,
    userId: string
  ): Promise<InstanceMailDomainSummary | null> {
    const client = requireClient();
    const normalized = domain.trim().toLowerCase();

    await assertDomainExists(client, normalized);

    const organizations = await resolveOrganizations([
      ...new Set(input.organizationIds),
    ]);
    const wanted = new Set(organizations.map((organization) => organization.id));

    const current = await prisma.orgMailDomain.findMany({
      where: { domain: normalized },
      select: { organizationId: true },
    });
    const held = new Set(current.map((row) => row.organizationId));

    const removed = [...held].filter((id) => !wanted.has(id));
    const added = [...wanted].filter((id) => !held.has(id));

    await prisma.$transaction([
      ...(removed.length > 0
        ? [
            prisma.mailDomainGrant.deleteMany({
              where: { domain: normalized, organizationId: { in: removed } },
            }),
            prisma.orgMailDomain.deleteMany({
              where: { domain: normalized, organizationId: { in: removed } },
            }),
          ]
        : []),
      ...(added.length > 0
        ? [
            prisma.orgMailDomain.createMany({
              data: added.map((organizationId) => ({
                domain: normalized,
                organizationId,
              })),
            }),
          ]
        : []),
    ]);

    if (organizations.length === 0) {
      return null;
    }

    const rows = await instanceAdminService.listDomains(userId);
    return rows.find((row) => row.domain.toLowerCase() === normalized) ?? null;
  },

  /**
   * Delete a domain from the mail server.
   *
   * Refused while any mailbox still exists on it. Mailcow would happily delete
   * the domain and every mailbox, alias and message under it in one call, and
   * that is far too much to hang on a single button — emptying the domain first
   * makes the blast radius something the administrator has already seen.
   */
  async deleteDomain(
    input: InstanceMailDomainDeleteInput
  ): Promise<MailDomainDeleteResult> {
    const client = requireClient();
    const domain = input.domain;

    if (input.confirm !== domain) {
      throw new HttpError(
        400,
        "Type the domain name exactly to confirm deletion",
        "validation_error"
      );
    }

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
    // deleted, because InboundMessage cascades from them. Unlike the org-scoped
    // version this is not filtered by organizationId — the domain is gone from
    // the server for everyone, so every org's bookkeeping for it must go.
    const suffix = `@${domain}`;
    const [connections, inboxes] = await prisma.$transaction([
      prisma.sMTPConnection.deleteMany({
        where: { fromEmail: { endsWith: suffix, mode: "insensitive" } },
      }),
      prisma.inboxAccount.updateMany({
        where: { email: { endsWith: suffix, mode: "insensitive" } },
        data: { status: "DISABLED" },
      }),
      prisma.mailDomainGrant.deleteMany({ where: { domain } }),
      prisma.orgMailDomain.deleteMany({ where: { domain } }),
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
   * answers and only one of them is the administrator's problem.
   */
  async dnsStatus(domain: string): Promise<MailDomainDnsStatus> {
    const client = requireClient();
    const mailHost = requireMailHost();
    const normalized = domain.trim().toLowerCase();

    await assertDomainExists(client, normalized);
    return buildDnsStatus(client, normalized, mailHost);
  },

  /**
   * Generate a DKIM key for a domain that has none.
   *
   * Never a rotation: Mailcow starts signing with the new key immediately, so
   * replacing a key whose record is already published would break every
   * signature until DNS caught up. Rotation stays in Mailcow, deliberately.
   */
  async generateDkim(domain: string): Promise<MailDomainDnsStatus> {
    const client = requireClient();
    const normalized = domain.trim().toLowerCase();

    await assertDomainExists(client, normalized);

    const existing = await client.getDkim(normalized).catch(() => null);
    if (existing) {
      throw new HttpError(
        409,
        `${normalized} already has a DKIM key. Rotate it in Mailcow if you mean to replace it.`,
        "conflict"
      );
    }

    await client.generateDkim(normalized);
    return instanceAdminService.dnsStatus(normalized);
  },

  /* ----------------------------------------------------------- mailboxes */

  /**
   * Every mailbox on the server, with the org holding its domain.
   *
   * Server inventory is the source: a mailbox created in the Mailcow UI is real
   * mail arriving whether or not QQueue knows about it, so an instance view that
   * only listed QQueue's own sending accounts would under-report the server.
   */
  async listMailboxes(userId: string): Promise<InstanceMailboxSummary[]> {
    const client = requireClient();
    const [mailboxes, assignments, mutes, connections] = await Promise.all([
      client.listMailboxes(),
      assignmentsByDomain(),
      loadMutes(userId),
      prisma.sMTPConnection.findMany({ select: { fromEmail: true } }),
    ]);

    const connected = new Set(
      connections.map((connection) => connection.fromEmail.toLowerCase())
    );

    return mailboxes
      .map((mailbox): InstanceMailboxSummary => {
        const domain = domainOf(mailbox.email);
        return {
          email: mailbox.email,
          domain,
          name: mailbox.name,
          active: mailbox.active,
          quotaBytes: mailbox.quotaBytes,
          usedBytes: mailbox.usedBytes,
          organizations: assignments.get(domain) ?? [],
          connected: connected.has(mailbox.email.toLowerCase()),
        };
      })
      .filter((mailbox) => !mutes.domains.has(mailbox.domain))
      .sort((a, b) => a.email.localeCompare(b.email));
  },

  /* -------------------------------------------------------------- grants */

  /**
   * Domain grants across the instance, or within one org.
   *
   * Instance-admin managed: the grant is what separates an ADMIN's provisioning
   * reach from an OWNER's, and since both roles are self-serve, letting an org
   * manage its own grants let a user widen their own reach.
   */
  listDomainGrants(organizationId?: string) {
    return prisma.mailDomainGrant.findMany({
      where: organizationId ? { organizationId } : {},
      include: {
        user: { select: { id: true, email: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ organizationId: "asc" }, { userId: "asc" }, { domain: "asc" }],
    });
  },

  async addDomainGrant(input: InstanceMailDomainGrantCreateInput) {
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

    // A grant is delegation *within* an assignment, so the org must hold the
    // domain first. Without this an administrator could grant an org access to
    // a domain it does not have, which would read as working and do nothing.
    const assignment = await prisma.orgMailDomain.findFirst({
      where: { domain, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!assignment) {
      throw new HttpError(
        400,
        `${domain} is not assigned to that organization`,
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
      include: {
        user: { select: { id: true, email: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
    });
  },

  async removeDomainGrant(id: string) {
    await prisma.mailDomainGrant.deleteMany({ where: { id } });
  },

  /* --------------------------------------------------------------- mutes */

  async listMutes(userId: string): Promise<InstanceAdminMute[]> {
    const rows = await prisma.instanceAdminMute.findMany({
      where: { userId },
      orderBy: [{ scope: "asc" }, { target: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope as InstanceMuteScope,
      target: row.target,
      createdAt: row.createdAt.toISOString(),
    }));
  },

  /**
   * Mute an org or a domain out of this administrator's own lists.
   *
   * Cosmetic only. It grants nothing and revokes nothing — assignment and
   * grants are the access controls, and this must never be mistaken for either.
   */
  async addMute(
    userId: string,
    input: InstanceMuteCreateInput
  ): Promise<InstanceAdminMute> {
    const target =
      input.scope === "DOMAIN" ? input.target.trim().toLowerCase() : input.target;

    const row = await prisma.instanceAdminMute.upsert({
      where: {
        userId_scope_target: { userId, scope: input.scope, target },
      },
      create: { userId, scope: input.scope, target },
      update: {},
    });

    return {
      id: row.id,
      scope: row.scope as InstanceMuteScope,
      target: row.target,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async removeMute(id: string, userId: string) {
    await prisma.instanceAdminMute.deleteMany({ where: { id, userId } });
  },
};
