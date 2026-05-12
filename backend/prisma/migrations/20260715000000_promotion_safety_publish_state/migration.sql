-- Phase — Academic Transition Safety + Promotion Foundations.
--
-- Pure additive:
--   • 4 new PlatformAuditAction enum values
--     (MARKS_PUBLISHED, MARKS_UNPUBLISHED, PROMOTION_PREVIEWED,
--     PROMOTION_EXECUTED).
--   • Exam: publishedAt + publishedById (+ SetNull FK).
--   • StudentAcademicRecord: nextClassId + nextSectionId +
--     promotedById (all SetNull FK so actor / class delete doesn't
--     bubble a constraint failure on five-year-old history).
--   • Indexes on the new FKs (point-reads + join filters).
--
-- No backfill: every existing row defaults to NULL on the new columns,
-- which is the correct "no historical data captured" semantics. The
-- publication and promotion-actor surfaces only matter going forward.
--
-- Hand-crafted per repo convention.

-- ============================================================================
-- 1. Audit enum additions
-- ============================================================================

ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'MARKS_PUBLISHED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'MARKS_UNPUBLISHED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'PROMOTION_PREVIEWED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'PROMOTION_EXECUTED';

-- ============================================================================
-- 2. Exam.publishedAt / publishedById
-- ============================================================================

ALTER TABLE "exams"
  ADD COLUMN IF NOT EXISTS "publishedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publishedById" UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_publishedById_fkey'
  ) THEN
    ALTER TABLE "exams"
      ADD CONSTRAINT "exams_publishedById_fkey"
      FOREIGN KEY ("publishedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- 3. StudentAcademicRecord — nextClassId + nextSectionId + promotedById
-- ============================================================================

ALTER TABLE "student_academic_records"
  ADD COLUMN IF NOT EXISTS "nextClassId"   UUID,
  ADD COLUMN IF NOT EXISTS "nextSectionId" UUID,
  ADD COLUMN IF NOT EXISTS "promotedById"  UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_academic_records_nextClassId_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_nextClassId_fkey"
      FOREIGN KEY ("nextClassId") REFERENCES "classes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_academic_records_nextSectionId_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_nextSectionId_fkey"
      FOREIGN KEY ("nextSectionId") REFERENCES "sections"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'student_academic_records_promotedById_fkey'
  ) THEN
    ALTER TABLE "student_academic_records"
      ADD CONSTRAINT "student_academic_records_promotedById_fkey"
      FOREIGN KEY ("promotedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Optional convenience indexes — promotion-history reads filter on
-- the actor, so an index on promotedById pays off in the audit feed.
CREATE INDEX IF NOT EXISTS "student_academic_records_promotedById_idx"
  ON "student_academic_records" ("promotedById");
