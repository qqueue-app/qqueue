-- Personal view filters for instance administrators.
--
-- Purely cosmetic and per-user: a row hides one org or one domain from that
-- administrator's own instance-wide lists. It grants nothing and revokes
-- nothing. Access lives in OrgMailDomain (assignment) and MailDomainGrant
-- (delegation), and the two must never be conflated — a filter that revoked
-- access would hide a permission you still have, and an access control dressed
-- as a filter would hide one you just took away.
--
-- No backfill: an absent row means "not muted", which is the correct state for
-- every existing administrator.
CREATE TYPE "InstanceMuteScope" AS ENUM ('ORG', 'DOMAIN');

CREATE TABLE "InstanceAdminMute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "InstanceMuteScope" NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceAdminMute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstanceAdminMute_userId_scope_target_key"
    ON "InstanceAdminMute"("userId", "scope", "target");

CREATE INDEX "InstanceAdminMute_userId_idx" ON "InstanceAdminMute"("userId");

ALTER TABLE "InstanceAdminMute"
    ADD CONSTRAINT "InstanceAdminMute_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
