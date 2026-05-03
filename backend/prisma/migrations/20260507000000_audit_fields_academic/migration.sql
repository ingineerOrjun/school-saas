-- ============================================================================
-- Audit fields on academic entities
-- ----------------------------------------------------------------------------
-- Adds `createdById` and `updatedById` (FK → users.id) to:
--   • subjects
--   • exams
--   • results
--
-- Both columns are NULLABLE — existing rows from before this migration
-- have no creator on file, and we'd rather keep the row than fabricate
-- attribution. New writes through the API populate both fields from
-- the JWT'd caller (`req.user.id`).
--
-- FK behavior is ON DELETE SET NULL — deleting a teacher/admin
-- shouldn't nuke the academic data they touched once. Idempotent
-- guards on every step so re-running this migration is a no-op.
-- ============================================================================

-- ----- subjects.createdById / updatedById -----------------------------------
ALTER TABLE "subjects" ADD COLUMN IF NOT EXISTS "createdById" UUID;
ALTER TABLE "subjects" ADD COLUMN IF NOT EXISTS "updatedById" UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subjects_createdById_fkey'
  ) THEN
    ALTER TABLE "subjects"
      ADD CONSTRAINT "subjects_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subjects_updatedById_fkey'
  ) THEN
    ALTER TABLE "subjects"
      ADD CONSTRAINT "subjects_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ----- exams.createdById / updatedById --------------------------------------
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "createdById" UUID;
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "updatedById" UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_createdById_fkey'
  ) THEN
    ALTER TABLE "exams"
      ADD CONSTRAINT "exams_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_updatedById_fkey'
  ) THEN
    ALTER TABLE "exams"
      ADD CONSTRAINT "exams_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ----- results.createdById / updatedById ------------------------------------
ALTER TABLE "results" ADD COLUMN IF NOT EXISTS "createdById" UUID;
ALTER TABLE "results" ADD COLUMN IF NOT EXISTS "updatedById" UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'results_createdById_fkey'
  ) THEN
    ALTER TABLE "results"
      ADD CONSTRAINT "results_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'results_updatedById_fkey'
  ) THEN
    ALTER TABLE "results"
      ADD CONSTRAINT "results_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
