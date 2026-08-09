-- Which Mailcow domains an organization claims.
--
-- Mailcow domains are instance-global (one API key, one mail server), but the
-- Mailboxes page is org-scoped. Before this table, visibleDomains() in
-- apps/api/src/modules/mailcow/service.ts returned *every* active server
-- domain to *any* org OWNER, so on a multi-org instance one org's owner could
-- list and provision mailboxes on another org's domains. This is the
-- ownership record that closes that.
--
-- "domain" is globally unique deliberately: a mail domain is one physical
-- thing on one server, so two orgs claiming it would reintroduce the same
-- leak.
CREATE TABLE "OrgMailDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMailDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrgMailDomain_domain_key" ON "OrgMailDomain"("domain");

CREATE INDEX "OrgMailDomain_organizationId_idx" ON "OrgMailDomain"("organizationId");

ALTER TABLE "OrgMailDomain"
    ADD CONSTRAINT "OrgMailDomain_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: claim, for each org, the domains it demonstrably already uses.
--
-- Gating OWNER visibility on this table without a backfill would silently
-- empty the Mailboxes page and the provisioning domain picker on every
-- existing install, which is exactly the failure the repo's migration rule
-- warns about. An org's sending accounts, synced inboxes and existing domain
-- grants are the evidence of which domains were already its own, and are
-- derivable here without reaching out to Mailcow.
--
-- Domains nobody claims are intentionally left unclaimed rather than assigned:
-- the service treats an unclaimed domain as visible-and-claimable to OWNERs,
-- so a single-org instance sees no change at all.
--
-- DISTINCT ON with the ORDER BY below resolves the case where two orgs used
-- the same domain: the earliest-created row wins, deterministically. The
-- ON CONFLICT keeps re-runs idempotent. gen_random_uuid() is built into
-- PostgreSQL 13+ and matches the SmtpConnectionGrant backfill in
-- 20260806210000.
INSERT INTO "OrgMailDomain" ("id", "domain", "organizationId", "createdAt")
SELECT DISTINCT ON (d."domain")
    gen_random_uuid()::text,
    d."domain",
    d."organizationId",
    CURRENT_TIMESTAMP
FROM (
    SELECT lower(split_part("fromEmail", '@', 2)) AS "domain",
           "organizationId",
           "createdAt"
      FROM "SMTPConnection"
     WHERE "fromEmail" LIKE '%@%'
    UNION ALL
    SELECT lower(split_part("email", '@', 2)) AS "domain",
           "organizationId",
           "createdAt"
      FROM "InboxAccount"
     WHERE "email" LIKE '%@%'
    UNION ALL
    SELECT lower("domain") AS "domain",
           "organizationId",
           "createdAt"
      FROM "MailDomainGrant"
) d
WHERE d."domain" <> ''
ORDER BY d."domain", d."createdAt", d."organizationId"
ON CONFLICT ("domain") DO NOTHING;
