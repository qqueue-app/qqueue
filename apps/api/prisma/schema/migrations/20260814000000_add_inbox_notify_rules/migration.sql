-- Per-mailbox notification preferences.
--
-- Until now "which of this org's mail may buzz my devices" was one column,
-- OrganizationMember.notifyLevel, answering ALL / ADDRESSED_TO_ME / NONE for
-- every mailbox at once. Once members hold individual mailboxes
-- (20260813000000), that single answer is too coarse: somebody who reads both
-- support@ and a quiet alias wants one of them to buzz and not the other, and
-- their only options were "everything" or "silence".
--
-- notifyLevel is kept and still means what it meant. The two are orthogonal:
-- these rows decide *which mailbox*, notifyLevel decides *which mail within
-- it*.
CREATE TYPE "InboxNotifyScope" AS ENUM ('DOMAIN', 'MAILBOX');

-- An exception list, not an allow-list. No rows means every mailbox you can
-- read notifies you, which is why this migration needs no backfill: every
-- existing member keeps exactly the notifications they had this morning, and
-- anyone granted a mailbox tomorrow hears about it without visiting settings
-- first.
--
-- `enabled` is nearly always false. A true row exists only to carve an
-- exception out of a DOMAIN rule that switched its domain off — "nothing from
-- acme.test except support@".
CREATE TABLE "InboxNotifyRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "InboxNotifyScope" NOT NULL,
    "domain" TEXT,
    "inboxAccountId" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxNotifyRule_pkey" PRIMARY KEY ("id")
);

-- One rule per target. Each index constrains only the rows of its own scope:
-- a MAILBOX rule leaves "domain" null and a DOMAIN rule leaves
-- "inboxAccountId" null, and Postgres treats nulls as distinct within a unique
-- index. That is the wanted behaviour rather than a loophole — the two scopes
-- are meant to coexist for the same user, and a partial index per scope would
-- say the same thing at more cost.
CREATE UNIQUE INDEX "InboxNotifyRule_userId_inboxAccountId_key" ON "InboxNotifyRule"("userId", "inboxAccountId");
CREATE UNIQUE INDEX "InboxNotifyRule_userId_organizationId_domain_key" ON "InboxNotifyRule"("userId", "organizationId", "domain");
-- The worker's read path: every rule one candidate recipient holds in one org.
CREATE INDEX "InboxNotifyRule_organizationId_userId_idx" ON "InboxNotifyRule"("organizationId", "userId");

-- Cascades all round. A preference is meaningless once its user, its
-- organization, or the mailbox it names is gone, and leaving orphans would let
-- a re-created mailbox inherit a mute nobody set for it.
ALTER TABLE "InboxNotifyRule" ADD CONSTRAINT "InboxNotifyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxNotifyRule" ADD CONSTRAINT "InboxNotifyRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboxNotifyRule" ADD CONSTRAINT "InboxNotifyRule_inboxAccountId_fkey" FOREIGN KEY ("inboxAccountId") REFERENCES "InboxAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
