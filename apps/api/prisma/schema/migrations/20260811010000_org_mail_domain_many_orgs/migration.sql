-- Let one mail domain be assigned to several organizations.
--
-- The single-org rule was a side effect of closing the self-serve claiming
-- hole, not the fix itself: what made the old model unsafe was that any user
-- could create an org, become its OWNER, and take a domain out of an unclaimed
-- pool. Assignment is an instance-admin act now regardless of how many orgs it
-- names, so widening it reopens nothing — and one company running several orgs
-- on a single domain is an ordinary thing to want.
--
-- Uniqueness moves from the domain to the (domain, organization) pair, which
-- keeps assignment idempotent. No backfill: every existing row is already
-- unique by domain alone, so it is unique by the pair too, and a domain that
-- names exactly one org stays a legal — and unchanged — state.
DROP INDEX "OrgMailDomain_domain_key";

CREATE UNIQUE INDEX "OrgMailDomain_domain_organizationId_key"
    ON "OrgMailDomain"("domain", "organizationId");

-- Lookups now filter by domain without hitting the old unique index.
CREATE INDEX "OrgMailDomain_domain_idx" ON "OrgMailDomain"("domain");
