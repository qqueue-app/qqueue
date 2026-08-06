-- Backfill send-as grants for members who predate them.
--
-- 20260806000000_add_smtp_connection_grants created the table but no rows.
-- Before that migration every MEMBER could send from every org connection;
-- after it, assertMayUseConnection (apps/api/src/lib/send-as.ts) denies a
-- MEMBER any connection they hold no grant for. Upgrading an instance that
-- already had members therefore silently revoked campaign starts, Email Studio
-- sends, draft saves, recurring-send edits and JWT transactional sends for
-- every one of them.
--
-- This grants each existing MEMBER the connections their org already had, which
-- is exactly the access they had before the upgrade. It does not change what
-- OWNER/ADMIN can do (they need no rows) and it grants nothing for members or
-- connections created later — those are an admin's explicit decision.
--
-- On a fresh install both tables are empty and this is a no-op. Re-running is
-- safe: ON CONFLICT DO NOTHING makes it idempotent against the unique
-- (smtpConnectionId, userId) index. gen_random_uuid() supplies the primary keys
-- (built into PostgreSQL 13+), matching the ContactListMember backfill in
-- 20260615010000.
INSERT INTO "SmtpConnectionGrant" ("id", "organizationId", "smtpConnectionId", "userId", "createdAt")
SELECT
    gen_random_uuid()::text,
    m."organizationId",
    c."id",
    m."userId",
    CURRENT_TIMESTAMP
FROM "OrganizationMember" m
JOIN "SMTPConnection" c ON c."organizationId" = m."organizationId"
WHERE m."role" = 'MEMBER'
ON CONFLICT ("smtpConnectionId", "userId") DO NOTHING;
