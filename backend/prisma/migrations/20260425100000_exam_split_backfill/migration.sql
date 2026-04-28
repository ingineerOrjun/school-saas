-- =============================================================================
-- Exams Phase 2a — Add theory/practical columns + backfill from legacy columns
-- =============================================================================
-- This migration is IDEMPOTENT and safe on three starting states:
--   1. Legacy production DB with `fullMarks` (on exam_subjects) and `marks`
--      (on results) — new columns are added, legacy values are copied over.
--   2. Fresh DB — new columns are added on empty tables; backfill is a no-op.
--   3. Already-migrated DB — ADD COLUMN IF NOT EXISTS skips, and the guard
--      clauses below skip the backfill too.
--
-- Legacy columns are NOT dropped here — that happens in a later migration
-- after ops verifies the backfill looks right. Keeping them around lets you
-- roll back by running UPDATE from the OLD columns if something's wrong.
-- =============================================================================

-- 1. Add new columns with defaults so NOT NULL is satisfied on existing rows.
ALTER TABLE "exam_subjects"
  ADD COLUMN IF NOT EXISTS "theoryFullMarks"    INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "practicalFullMarks" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "results"
  ADD COLUMN IF NOT EXISTS "theoryMarks"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "practicalMarks" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2. Backfill from legacy columns ONLY if they still exist on this DB.
--    `information_schema` lookups make this safe on DBs that never had the
--    legacy columns (fresh installs) or that already dropped them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'exam_subjects'
      AND column_name  = 'fullMarks'
  ) THEN
    EXECUTE 'UPDATE "exam_subjects"
               SET "theoryFullMarks" = "fullMarks"
               WHERE "fullMarks" IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'results'
      AND column_name  = 'marks'
  ) THEN
    EXECUTE 'UPDATE "results"
               SET "theoryMarks" = "marks"
               WHERE "marks" IS NOT NULL';
  END IF;
END
$$;
