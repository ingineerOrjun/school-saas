-- Phase — Soft-delete foundations for Student + Exam.
--
-- Pure additive: three nullable columns + a SetNull FK on each
-- entity, four new audit enum values, two composite indexes for
-- the default "non-archived first" listings. No backfill required
-- — every existing row stays unarchived.
--
-- Hand-crafted per repo convention.

-- ============================================================================
-- 1. Audit enum additions
-- ============================================================================

ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'STUDENT_ARCHIVED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'STUDENT_RESTORED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'EXAM_ARCHIVED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'EXAM_RESTORED';

-- ============================================================================
-- 2. Student.archive*
-- ============================================================================

ALTER TABLE "students"
  ADD COLUMN IF NOT EXISTS "archivedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archivedById"  UUID,
  ADD COLUMN IF NOT EXISTS "archiveReason" VARCHAR(500);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_archivedById_fkey'
  ) THEN
    ALTER TABLE "students"
      ADD CONSTRAINT "students_archivedById_fkey"
      FOREIGN KEY ("archivedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "students_schoolId_archivedAt_idx"
  ON "students" ("schoolId", "archivedAt");

-- ============================================================================
-- 3. Exam.archive*
-- ============================================================================

ALTER TABLE "exams"
  ADD COLUMN IF NOT EXISTS "archivedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archivedById"  UUID,
  ADD COLUMN IF NOT EXISTS "archiveReason" VARCHAR(500);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_archivedById_fkey'
  ) THEN
    ALTER TABLE "exams"
      ADD CONSTRAINT "exams_archivedById_fkey"
      FOREIGN KEY ("archivedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "exams_schoolId_archivedAt_idx"
  ON "exams" ("schoolId", "archivedAt");
