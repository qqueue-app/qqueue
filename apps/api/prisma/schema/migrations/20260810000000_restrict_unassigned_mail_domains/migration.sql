-- An unassigned Mailcow domain now reaches no organization at all.
--
-- 20260809000000 added OrgMailDomain but kept unclaimed domains visible to
-- every org OWNER as a claimable pool, so a single-org install would see no
-- change. That pool is the leak: POST /organizations is ungated, so any user
-- on the instance could create an org, become its OWNER, and from there list,
-- claim, create and delete domains on the mail server the whole install
-- shares. orgDomainScope() in apps/api/src/modules/mailcow/service.ts now
-- returns only domains explicitly assigned here, and assertDomainAccess()
-- default-denies an unassigned one. Assignment became an instance-admin act.
--
-- Tightening that gate without a backfill would revoke access an org already
-- had, which is exactly the failure the repo's migration rule warns about.
-- 20260809000000 ran the same derivation, but it could not cover what happened
-- afterwards: mailbox provisioning (connectMailbox) writes an SMTPConnection
-- and an InboxAccount but never an OrgMailDomain row, so any mailbox an OWNER
-- provisioned on an unclaimed domain since then works today with no ownership
-- record. Re-deriving picks those up.
--
-- Identical logic to the 20260809000000 backfill, deliberately: same three
-- sources of evidence (sending accounts, synced inboxes, existing domain
-- grants), same DISTINCT ON tie-break so two orgs on one domain resolve to the
-- earliest-created row deterministically, same ON CONFLICT for idempotency.
-- Rows written by the earlier run simply conflict and are kept.
--
-- Domains with none of that evidence stay unassigned on purpose. Nothing is
-- sending or receiving on them, so no access is being taken away — they become
-- what they always should have been: instance infrastructure, assignable by an
-- instance administrator.
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
