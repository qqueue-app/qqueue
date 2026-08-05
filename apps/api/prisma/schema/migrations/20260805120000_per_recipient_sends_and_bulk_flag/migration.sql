-- Phase 2: per-recipient send jobs, List-Unsubscribe by bulkness, and
-- case-insensitive email handling.

-- Bulk mail (campaign fan-out, recurring sends) carries List-Unsubscribe
-- headers; the flag is set at job creation instead of inferred from origin.
ALTER TABLE "EmailJob" ADD COLUMN "isBulk" BOOLEAN NOT NULL DEFAULT false;

-- In-flight campaign jobs created before this migration keep their headers.
UPDATE "EmailJob" SET "isBulk" = true WHERE "origin" = 'CAMPAIGN';

-- Groups the per-recipient jobs of one multi-recipient manual/recurring send.
ALTER TABLE "EmailJob" ADD COLUMN "sendGroupId" TEXT;

CREATE INDEX "EmailJob_organizationId_sendGroupId_idx"
  ON "EmailJob"("organizationId", "sendGroupId");

-- ---------------------------------------------------------------------------
-- Email addresses are case-insensitive in practice; suppression and bounce
-- accounting match on exact strings. Normalize stored addresses to lowercase.

-- Suppressions: a lowercase collision within an org means the same address was
-- suppressed twice under different casings — keep the earliest row (suppression
-- is a boolean fact; merging loses nothing), then lowercase everything.
DELETE FROM "Suppression" s
USING "Suppression" k
WHERE s."organizationId" = k."organizationId"
  AND lower(s."email") = lower(k."email")
  AND s."id" <> k."id"
  AND (k."createdAt" < s."createdAt"
       OR (k."createdAt" = s."createdAt" AND k."id" < s."id"));

UPDATE "Suppression" SET "email" = lower("email")
WHERE "email" <> lower("email");

-- Contacts: two contacts whose emails differ only by case may each carry real
-- history (list memberships, tags), so they are NOT merged here. Lowercase only
-- rows whose lowercase form is unambiguous within the org; colliding rows are
-- left untouched and remain visible to operators to reconcile by hand.
UPDATE "Contact" c SET "email" = lower("email")
WHERE "email" <> lower("email")
  AND NOT EXISTS (
    SELECT 1 FROM "Contact" o
    WHERE o."organizationId" = c."organizationId"
      AND lower(o."email") = lower(c."email")
      AND o."id" <> c."id"
  );

-- Email jobs: no uniqueness on recipients, so lowercase unconditionally. The
-- soft-bounce counter joins on toEmail and the suppression re-check compares it.
UPDATE "EmailJob" SET "toEmail" = lower("toEmail")
WHERE "toEmail" <> lower("toEmail");

UPDATE "EmailJob"
SET "cc" = (SELECT coalesce(array_agg(lower(x) ORDER BY ord), '{}')
            FROM unnest("cc") WITH ORDINALITY AS t(x, ord))
WHERE EXISTS (SELECT 1 FROM unnest("cc") x WHERE x <> lower(x));

UPDATE "EmailJob"
SET "bcc" = (SELECT coalesce(array_agg(lower(x) ORDER BY ord), '{}')
             FROM unnest("bcc") WITH ORDINALITY AS t(x, ord))
WHERE EXISTS (SELECT 1 FROM unnest("bcc") x WHERE x <> lower(x));
