-- ============================================================================
-- Academic Session system (multi-year support)
-- ----------------------------------------------------------------------------
-- One row per academic year per school. Adds nullable `sessionId` to
-- the four academic tables that should be year-scoped:
--   • exams           — every exam belongs to a session
--   • results         — denormalized from the exam for fast filtering
--   • attendance      — daily attendance is session-scoped
--   • announcements   — optional classifier; the feed doesn't filter by
--                       it by default (announcements often span sessions)
--
-- Existing rows on those tables stay sessionId = NULL until the school
-- explicitly assigns them — query layers treat NULL as "any session"
-- so legacy data stays visible during the transition.
--
-- "Only one active session per school" is enforced by a partial unique
-- index — Prisma can't model partial indexes, so we add it raw here.
-- The session service ALSO enforces it inside a transaction as a
-- belt-and-suspenders, but the DB index is the real guarantee.
--
-- All steps idempotent — re-running the migration is a no-op.
-- ============================================================================

-- ----- Create academic_sessions table ---------------------------------------
CREATE TABLE IF NOT EXISTS "academic_sessions" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"      VARCHAR(40)  NOT NULL,
  "startDate" DATE         NOT NULL,
  "endDate"   DATE         NOT NULL,
  "isActive"  BOOLEAN      NOT NULL DEFAULT FALSE,
  "schoolId"  UUID         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id")
);

-- Per-school name uniqueness — "2082/83" can only mean one row in a
-- given school; different schools can have their own.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'academic_sessions_schoolId_name_key'
  ) THEN
    CREATE UNIQUE INDEX "academic_sessions_schoolId_name_key"
      ON "academic_sessions" ("schoolId", "name");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'academic_sessions_schoolId_idx'
  ) THEN
    CREATE INDEX "academic_sessions_schoolId_idx" ON "academic_sessions" ("schoolId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'academic_sessions_schoolId_isActive_idx'
  ) THEN
    CREATE INDEX "academic_sessions_schoolId_isActive_idx"
      ON "academic_sessions" ("schoolId", "isActive");
  END IF;
END $$;

-- Partial unique index — at MOST one row per school can have
-- isActive = true. The session service still uses a transaction to
-- flip the flag atomically, but this index is the hard guarantee
-- against race conditions.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'academic_sessions_schoolId_active_unique'
  ) THEN
    CREATE UNIQUE INDEX "academic_sessions_schoolId_active_unique"
      ON "academic_sessions" ("schoolId")
      WHERE "isActive" = true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_sessions_schoolId_fkey'
  ) THEN
    ALTER TABLE "academic_sessions"
      ADD CONSTRAINT "academic_sessions_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ----- Add sessionId columns + FKs to the four target tables ----------------
-- Pattern repeats four times: ADD COLUMN IF NOT EXISTS, then guarded
-- ALTER TABLE … ADD CONSTRAINT for the FK, then index.

-- exams.sessionId
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "sessionId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_sessionId_fkey'
  ) THEN
    ALTER TABLE "exams"
      ADD CONSTRAINT "exams_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'exams_schoolId_sessionId_idx'
  ) THEN
    CREATE INDEX "exams_schoolId_sessionId_idx" ON "exams" ("schoolId", "sessionId");
  END IF;
END $$;

-- results.sessionId
ALTER TABLE "results" ADD COLUMN IF NOT EXISTS "sessionId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'results_sessionId_fkey'
  ) THEN
    ALTER TABLE "results"
      ADD CONSTRAINT "results_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'results_sessionId_idx'
  ) THEN
    CREATE INDEX "results_sessionId_idx" ON "results" ("sessionId");
  END IF;
END $$;

-- attendance.sessionId
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "sessionId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_sessionId_fkey'
  ) THEN
    ALTER TABLE "attendance"
      ADD CONSTRAINT "attendance_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'attendance_schoolId_sessionId_date_idx'
  ) THEN
    CREATE INDEX "attendance_schoolId_sessionId_date_idx"
      ON "attendance" ("schoolId", "sessionId", "date");
  END IF;
END $$;

-- announcements.sessionId
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "sessionId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'announcements_sessionId_fkey'
  ) THEN
    ALTER TABLE "announcements"
      ADD CONSTRAINT "announcements_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'announcements_schoolId_sessionId_idx'
  ) THEN
    CREATE INDEX "announcements_schoolId_sessionId_idx"
      ON "announcements" ("schoolId", "sessionId");
  END IF;
END $$;
