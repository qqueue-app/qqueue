-- Give an organization a place to store how its outbound mail looks.
--
-- Until now the email-safe render layer accepted branding (a wordmark or logo,
-- an accent colour, small print under the footer) but nothing in the product
-- could supply it: the fields existed only as a function argument no caller
-- filled in. These four columns are that missing source.
--
-- All four are nullable, and null is a meaningful value rather than an
-- unconfigured one. The render layer draws no header when there is no brand
-- name or logo, and no footer line when there is no note, precisely so that
-- mail from a self-hosted install is never stamped with a vendor name its
-- owner did not choose. Nullable therefore needs no backfill: every existing
-- organization keeps exactly the behaviour it has today, which is "no branding
-- added", and upgrading takes nothing away from anyone.
--
-- `footerNote` carries the postal address that anti-spam law expects on bulk
-- mail. It is stored as free text rather than structured address fields because
-- the legal requirement varies by region and a sender knows their own format
-- better than a schema does.
ALTER TABLE "Organization"
    ADD COLUMN "brandName" TEXT,
    ADD COLUMN "logoUrl" TEXT,
    ADD COLUMN "accentColor" TEXT,
    ADD COLUMN "footerNote" TEXT;
