-- Append-only refund support. We never DELETE or UPDATE the original
-- payment row when a refund is issued; instead, a new payment row is
-- written with negative `amount` and a back-link to the source.
--
-- That preserves the audit trail (the original receipt stays valid
-- forever) and makes balance arithmetic correct without special cases —
-- summing payments naturally subtracts refunds.

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refundOfPaymentId" UUID,
  ADD COLUMN IF NOT EXISTS "refundReason"      TEXT;

-- One refund per source payment. (Partial refunds split into multiple
-- rows would each link the same source — that complicates audit. If
-- the school needs partial-refunds-of-partial-refunds we'd revisit, but
-- in practice schools issue at most one reversal per receipt.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'payments_refundOfPaymentId_key'
  ) THEN
    CREATE UNIQUE INDEX "payments_refundOfPaymentId_key"
      ON "payments"("refundOfPaymentId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_refundOfPaymentId_fkey'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_refundOfPaymentId_fkey"
      FOREIGN KEY ("refundOfPaymentId") REFERENCES "payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
