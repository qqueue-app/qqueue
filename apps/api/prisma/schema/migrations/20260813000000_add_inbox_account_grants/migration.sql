-- Per-mailbox read access.
--
-- Until now every member of an organization could read every message in it:
-- inboxService.listMessages filtered on organizationId alone. Grants existed
-- only for sending (SmtpConnectionGrant, added in 20260806000000). This table
-- is the read-side counterpart, and lib/mailbox-access.ts now denies a MEMBER
-- any mailbox they hold no row for. OWNER/ADMIN need no rows.
CREATE TABLE "InboxAccountGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inboxAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxAccountGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxAccountGrant_inboxAccountId_userId_key" ON "InboxAccountGrant"("inboxAccountId", "userId");
CREATE INDEX "InboxAccountGrant_organizationId_userId_idx" ON "InboxAccountGrant"("organizationId", "userId");

ALTER TABLE "InboxAccountGrant" ADD CONSTRAINT "InboxAccountGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxAccountGrant" ADD CONSTRAINT "InboxAccountGrant_inboxAccountId_fkey" FOREIGN KEY ("inboxAccountId") REFERENCES "InboxAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxAccountGrant" ADD CONSTRAINT "InboxAccountGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill read access from the send access each member already has.
--
-- Adding this gate revokes something every member had, so it needs a starting
-- point that is neither "nobody can read anything" (an admin would have to
-- re-tick every box before the inbox worked again) nor "everybody keeps
-- reading everything" (which is the behaviour this change exists to end).
--
-- Mirroring SmtpConnectionGrant is that starting point, and it lands in the
-- right place on both kinds of instance. An instance upgraded through
-- 20260806210000 gave every then-existing MEMBER a grant on every then-existing
-- connection, so those members keep reading the mailboxes they already read.
-- Grants an admin has since chosen deliberately are mirrored just as
-- deliberately. Either way the product's one-toggle invariant — access means
-- read and send together — holds for every row that predates it.
--
-- The two sides are paired by address, case-insensitively, because
-- InboxAccount and SMTPConnection have no foreign key between them; this is the
-- same pairing lib/mailbox-access.ts does at runtime. A receive-only mailbox
-- (no matching connection) therefore backfills to nobody and starts admin-only,
-- which is the safe direction.
--
-- On a fresh install every source table is empty and this is a no-op.
-- Re-running is safe: ON CONFLICT DO NOTHING makes it idempotent against the
-- unique (inboxAccountId, userId) index. gen_random_uuid() supplies the primary
-- keys (built into PostgreSQL 13+), matching 20260806210000.
INSERT INTO "InboxAccountGrant" ("id", "organizationId", "inboxAccountId", "userId", "createdAt")
SELECT
    gen_random_uuid()::text,
    g."organizationId",
    i."id",
    g."userId",
    CURRENT_TIMESTAMP
FROM "SmtpConnectionGrant" g
JOIN "SMTPConnection" c ON c."id" = g."smtpConnectionId"
JOIN "InboxAccount" i
    ON i."organizationId" = g."organizationId"
    AND lower(i."email") = lower(c."fromEmail")
ON CONFLICT ("inboxAccountId", "userId") DO NOTHING;
