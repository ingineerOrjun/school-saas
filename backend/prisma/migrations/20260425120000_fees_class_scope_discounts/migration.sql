-- =============================================================================
-- Fees Phase 2: class-scoped fee structures + per-assignment scholarships
-- =============================================================================
-- Adds two independent capabilities:
--   1. FeeStructure.classId — optional, narrows a fee to students of one
--      class (e.g. "Grade 10 boarding fee"). Null = school-wide fee.
--   2. FeeAssignment.discountType/discountValue — per-student scholarship
--      or ad-hoc reduction. Final due amount is computed at read time:
--         PERCENT → amount - (amount * value / 100)
--         FIXED   → amount - value
--      clamped to 0.
--
-- Fully idempotent: safe to re-run on fresh DBs, existing DBs, and DBs
-- where this migration already ran. All DDL is guarded.
-- =============================================================================

-- 1. Create the DiscountType enum if it doesn't already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'DiscountType'
  ) THEN
    CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');
  END IF;
END
$$;

-- 2. Add the new columns.
ALTER TABLE "fee_structures"
  ADD COLUMN IF NOT EXISTS "classId" UUID;

ALTER TABLE "fee_assignments"
  ADD COLUMN IF NOT EXISTS "discountType"  "DiscountType",
  ADD COLUMN IF NOT EXISTS "discountValue" DOUBLE PRECISION;

-- 3. FK from fee_structures.classId → classes.id. Wrapped in a guarded
--    DO-block so this migration is safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fee_structures_classId_fkey'
  ) THEN
    ALTER TABLE "fee_structures"
      ADD CONSTRAINT "fee_structures_classId_fkey"
      FOREIGN KEY ("classId") REFERENCES "classes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- 4. Index on the new FK for fast class-scoped lookups.
CREATE INDEX IF NOT EXISTS "fee_structures_classId_idx"
  ON "fee_structures"("classId");
