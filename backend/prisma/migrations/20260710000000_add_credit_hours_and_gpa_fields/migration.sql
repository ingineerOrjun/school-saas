-- Phase γ — credit-hour-weighted GPA per Nepal CDC progress-report formula:
--   GPA = Σ(gradePoint_i × creditHours_i) / Σ(creditHours_i)
--
-- This migration adds the two pieces of state needed to compute and
-- archive that GPA without breaking any existing rows:
--
--   1. ExamSubject.creditHours
--      The per-subject weight (CDC weekly-period count). Default of 5
--      matches the most common weekly allocation, so existing rows
--      remain valid without a backfill.
--
--   2. StudentAcademicRecord.{gpa, gpaLetterGrade, totalCreditHours}
--      Nullable — historical promotion records written before this
--      column existed are unaffected, and promotions that run for a
--      session with no exam results stay at NULL.
--
-- Hand-crafted to match the codebase convention (migrations here are
-- explicit hand-written SQL, see e.g. 20260620000000_phase_alpha_backup_runs).
-- Mirrors `prisma migrate diff`'s output for these two tables exactly.

-- ExamSubject — add creditHours with a safe default.
ALTER TABLE "exam_subjects"
  ADD COLUMN "creditHours" DOUBLE PRECISION NOT NULL DEFAULT 5;

-- StudentAcademicRecord — add the three GPA-snapshot columns.
-- All three are nullable: a promotion can legitimately complete with
-- no exam results to summarize.
ALTER TABLE "student_academic_records"
  ADD COLUMN "gpa"              DOUBLE PRECISION,
  ADD COLUMN "gpaLetterGrade"   TEXT,
  ADD COLUMN "totalCreditHours" DOUBLE PRECISION;
