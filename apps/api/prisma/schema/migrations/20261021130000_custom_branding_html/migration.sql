-- Existing organizations retain their saved identity and original renderer.
ALTER TABLE "Organization" ADD COLUMN "layoutHtml" TEXT;
