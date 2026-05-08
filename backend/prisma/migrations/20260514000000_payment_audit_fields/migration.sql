-- ---------------------------------------------------------------------------
-- Payment audit fields: who created the row, who last edited it.
--
-- Required so the receipt slip + the global payment history can answer
-- "which cashier took this in?" — a basic accounting question and an
-- audit-trail prerequisite.
--
-- Both columns are nullable: legacy rows that pre-date this migration
-- have no recorded operator, and we'd rather render "—" on the slip
-- than backfill speculative ownership.
--
-- ON DELETE SET NULL — if a user is removed, the payment row stays
-- (we never destroy financial history) but the FK clears so the row
-- doesn't drag a phantom user along.
-- ---------------------------------------------------------------------------

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "createdById" UUID,
  ADD COLUMN IF NOT EXISTS "updatedById" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_createdById_fkey'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_updatedById_fkey'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "payments_createdById_idx" ON "payments" ("createdById");
