-- Transactional idempotency keys.
--
-- Adds a nullable `idempotencyKey` to EmailJob plus a unique
-- (organizationId, idempotencyKey) index. A client retrying a transactional
-- send with the same `Idempotency-Key` header returns the original job instead
-- of sending a second copy. NULL keys are unconstrained (Postgres treats NULLs
-- as distinct in a unique index), so campaign and manual sends that don't supply
-- a key are unaffected. Additive only — no existing column is altered.

-- AlterTable
ALTER TABLE "EmailJob" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EmailJob_organizationId_idempotencyKey_key" ON "EmailJob"("organizationId", "idempotencyKey");
