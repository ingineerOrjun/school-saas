-- =============================================================================
-- Students → Class direct link
-- =============================================================================
-- Adds optional `classId` to students so that:
--   1. Small schools with classes-without-sections can still link students
--      to a class.
--   2. Filtering students by class works even for students without a section.
--
-- When both `classId` and `sectionId` are set, the application layer
-- enforces section.classId == classId (we don't add a CHECK constraint
-- because it would require a subquery; Postgres doesn't support that in
-- CHECK expressions).
--
-- This migration is IDEMPOTENT:
--   * ADD COLUMN IF NOT EXISTS skips on already-migrated DBs.
--   * The backfill only runs for students who have a section but no
--     `classId` yet (covers first-time migration and partial re-runs).
-- =============================================================================

-- 1. Add the column.
ALTER TABLE "students"
  ADD COLUMN IF NOT EXISTS "classId" UUID;

-- 2. Add the foreign key. Wrapped in DO-block so we can skip cleanly when
--    the constraint already exists (re-running the migration against a
--    post-state DB).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_classId_fkey'
  ) THEN
    ALTER TABLE "students"
      ADD CONSTRAINT "students_classId_fkey"
      FOREIGN KEY ("classId") REFERENCES "classes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- 3. Index for the new FK so list filters (`WHERE classId = $1`) stay fast.
CREATE INDEX IF NOT EXISTS "students_classId_idx" ON "students"("classId");

-- 4. Backfill: any student who already has a section should get the
--    section's classId propagated onto their own row. Safe to re-run.
UPDATE "students" s
SET "classId" = sec."classId"
FROM "sections" sec
WHERE s."sectionId" = sec."id"
  AND s."classId" IS NULL;
