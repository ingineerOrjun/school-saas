-- ---------------------------------------------------------------------------
-- Payment hardening: idempotency keys + status enum.
--
-- Idempotency
--   `clientRequestId` is a caller-supplied UUID. Two POST /payments calls
--   with the same key (same school) resolve to the same Payment row —
--   the unique constraint catches the second insert and the service
--   returns the original. Defends against double-clicks, slow-network
--   retries, and offline queue replays.
--
-- Status
--   Replaces the implicit "is this row a refund?" check with an explicit
--   enum. Refunding a payment now flips the source row to REFUNDED
--   instead of just relying on the back-link. VOID is reserved for
--   future "cancel before reconciliation" flows; not currently set by
--   any code path.
-- ---------------------------------------------------------------------------

-- Status enum: idempotent create.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentStatus') THEN
    CREATE TYPE "PaymentStatus" AS ENUM ('ACTIVE', 'REFUNDED', 'VOID');
  END IF;
END $$;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "clientRequestId" UUID,
  ADD COLUMN IF NOT EXISTS "status" "PaymentStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill status for any rows that pre-date this migration:
--   • Negative-amount rows are refund slips → ACTIVE (the refund itself is
--     a real payment, not in a degraded state).
--   • Source rows that have been refunded → REFUNDED.
-- Done before adding the unique constraint so existing data is consistent.
UPDATE "payments" p
   SET "status" = 'REFUNDED'
  FROM "payments" r
 WHERE r."refundOfPaymentId" = p."id"
   AND p."status" = 'ACTIVE';

-- Unique key per school. NULL clientRequestId is permitted (legacy rows
-- and older API callers); only NON-NULL keys are deduped, which matches
-- how PostgreSQL treats NULL in unique indexes by default.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_schoolId_clientRequestId_key"
  ON "payments" ("schoolId", "clientRequestId");

CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" ("status");
