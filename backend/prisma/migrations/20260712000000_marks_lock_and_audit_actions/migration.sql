-- Phase — Marks publication lock + bulk-attendance audit + 2 marks-lock
-- audit actions. Pure additive: every existing exam stays unlocked
-- (locked = false default), every existing audit stream still works.
--
-- Hand-crafted to match the codebase migration convention (see
-- 20260711000000_school_code_and_student_registration). Idempotent
-- with `IF NOT EXISTS` / `IF EXISTS` guards.

-- ============================================================================
-- 1. Audit enum additions
-- ============================================================================

ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'MARKS_LOCKED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'MARKS_UNLOCKED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'ATTENDANCE_BULK_OVERWRITE';

-- ============================================================================
-- 2. Exam.locked + lockedAt + lockedById
-- ----------------------------------------------------------------------------
-- All three are nullable / defaulted so existing rows stay valid
-- without a backfill step. The FK to users is SetNull so deleting
-- the locking admin doesn't cascade-destroy exam rows.
-- ============================================================================

ALTER TABLE "exams"
  ADD COLUMN IF NOT EXISTS "locked"     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "lockedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedById" UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_lockedById_fkey'
  ) THEN
    ALTER TABLE "exams"
      ADD CONSTRAINT "exams_lockedById_fkey"
      FOREIGN KEY ("lockedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
