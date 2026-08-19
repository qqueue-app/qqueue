-- A campaign picks the account it sends as.
--
-- Campaign fan-out resolved `isDefault: true` in the worker and threw when
-- there was no default, so every campaign an organization ever sent went out
-- as one address. An org that runs a newsletter from hello@ and a product
-- announcement from product@ had no way to say so — the only workaround was to
-- flip the org default before each send, which changes every other send path
-- at the same time.
--
-- Nullable, and no backfill, deliberately. NULL keeps meaning exactly what it
-- meant before the column existed: send as whatever the organization's default
-- is at fire time. Backfilling the current default onto existing campaigns
-- would freeze them against today's answer and silently change what a
-- recurring campaign does when the default moves.
--
-- ON DELETE SET NULL for the same reason: removing a sending account returns
-- the campaigns that named it to the default rather than orphaning them or
-- cascading a campaign away. Send-as enforcement stays where it already is —
-- checked once when the campaign is started, never re-verified in the worker.
ALTER TABLE "Campaign" ADD COLUMN     "smtpConnectionId" TEXT;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_smtpConnectionId_fkey" FOREIGN KEY ("smtpConnectionId") REFERENCES "SMTPConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
