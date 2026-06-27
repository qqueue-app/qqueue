-- Richer templates.
--
-- Adds optional metadata + personalization columns to Template so the dashboard
-- can offer categories/tags, a managed variables panel, and reproducible
-- previews. Every column is nullable or defaulted, so existing rows need no
-- backfill and existing send paths are unaffected. Additive only.

-- AlterTable
ALTER TABLE "Template" ADD COLUMN "description" TEXT;
ALTER TABLE "Template" ADD COLUMN "category" TEXT;
ALTER TABLE "Template" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Template" ADD COLUMN "variables" JSONB;
ALTER TABLE "Template" ADD COLUMN "previewData" JSONB;
