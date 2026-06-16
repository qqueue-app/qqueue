-- Phase D2: per-domain send throttling.
--
-- Fully additive and backward compatible: one new table. The send worker
-- enforces the caps via a Redis fixed-window counter; absent rows fall back to
-- the DEFAULT_DOMAIN_MAX_PER_MINUTE env default, so existing sends are unchanged.

-- CreateTable: per-org, per-domain send-rate caps. domain = '' is the org-wide
-- default; a specific domain overrides it.
CREATE TABLE "DomainThrottle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT '',
    "maxPerMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainThrottle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainThrottle_organizationId_idx" ON "DomainThrottle"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainThrottle_organizationId_domain_key" ON "DomainThrottle"("organizationId", "domain");

-- AddForeignKey
ALTER TABLE "DomainThrottle" ADD CONSTRAINT "DomainThrottle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
