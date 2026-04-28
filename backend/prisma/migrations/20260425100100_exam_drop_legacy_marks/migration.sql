-- =============================================================================
-- Exams Phase 2b — Drop legacy `fullMarks` / `marks` after backfill verified
-- =============================================================================
-- Deploy this migration ONLY after confirming the backfill in Phase 2a
-- produced the expected values in `theoryFullMarks` / `theoryMarks` on your
-- production data. Sanity check before deploying:
--
--   SELECT count(*) FROM exam_subjects
--     WHERE "fullMarks" IS NOT NULL AND "fullMarks" <> "theoryFullMarks";
--   -- expected: 0
--
--   SELECT count(*) FROM results
--     WHERE "marks" IS NOT NULL AND "marks" <> "theoryMarks";
--   -- expected: 0
--
-- `DROP COLUMN IF EXISTS` makes this safe to re-run or apply on DBs that
-- never had the legacy columns to begin with.
-- =============================================================================

ALTER TABLE "exam_subjects" DROP COLUMN IF EXISTS "fullMarks";
ALTER TABLE "results"       DROP COLUMN IF EXISTS "marks";
