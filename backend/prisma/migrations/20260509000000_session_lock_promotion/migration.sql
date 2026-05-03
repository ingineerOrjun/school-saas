-- ============================================================================
-- Session lock + promotion history
-- ----------------------------------------------------------------------------
-- Adds:
--   • academic_sessions.isLocked (BOOLEAN NOT NULL DEFAULT false)
--   • StudentSessionStatus enum
--   • student_academic_records table — one row per (student, session)
--     capturing the class they were in and the outcome of the year
--     (PROMOTED / RETAINED / LEFT). Immutable history written by the
--     promotion endpoint.
--
-- Idempotent: every CREATE/ALTER guarded so re-running is a no-op.
-- ============================================================================

-- ----- Enum -----------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentSessionStatus') THEN
    CREATE TYPE "StudentSessionStatus" AS ENUM ('PROMOTED', 'RETAINED', 'LEFT');
  END IF;
END $$;

-- ----- academic_sessions.isLocked -------------------------------------------
ALTER TABLE "academic_sessions"
  ADD COLUMN IF NOT EXISTS "isLocked" BOOLEAN NOT NULL DEFAULT FALSE;

-- ----- student_academic_records --------------------------------------------
CREATE TABLE IF NOT EXISTS "student_academic_records" (
  "id"        UUID                   NOT NULL DEFAULT gen_random_uuid(),
  "studentId" UUID                   NOT NULL,
  "sessionId" UUID                   NOT NULL,
  "classId"   UUID                   NOT NULL,
  "sectionId" UUID,
  "schoolId"  UUID                   NOT NULL,
  "status"    "StudentSessionStatus" NOT NULL DEFAULT 'PROMOTED',
  "createdAt" TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "student_academic_records_pkey" PRIMARY KEY ("id")
);

-- One outcome per student per session.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'student_academic_records_studentId_sessionId_key'
  ) THEN
    CREATE UNIQUE INDEX "student_academic_records_studentId_sessionId_key"
      ON "student_academic_records" ("studentId", "sessionId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'student_academic_records_sessionId_idx'
  ) THEN
    CREATE INDEX "student_academic_records_sessionId_idx"
      ON "student_academic_records" ("sessionId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'student_academic_records_classId_idx'
  ) THEN
    CREATE INDEX "student_academic_records_classId_idx"
      ON "student_academic_records" ("classId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'student_academic_records_schoolId_idx'
  ) THEN
    CREATE INDEX "student_academic_records_schoolId_idx"
      ON "student_academic_records" ("schoolId");
  END IF;
END $$;

-- FKs — cascade for tenant + parent-session deletes; setNull for
-- section (the row keeps meaning even if the section is reorganized).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_records_studentId_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "students"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_records_sessionId_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_records_classId_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_classId_fkey"
      FOREIGN KEY ("classId") REFERENCES "classes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_records_sectionId_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_sectionId_fkey"
      FOREIGN KEY ("sectionId") REFERENCES "sections"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_academic_records_schoolId_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
