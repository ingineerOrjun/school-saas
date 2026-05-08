-- ============================================================================
-- Drop legacy class/section columns from teachers.
-- ----------------------------------------------------------------------------
-- TeachingAssignment is now the ONLY source of truth for what a teacher
-- can act on. The single-class fields on the Teacher row (classId,
-- sectionId) are obsolete:
--
--   • Permissions read from TeachingAssignment (TeacherScopeService).
--   • Dashboard reads from TeachingAssignment (DashboardService).
--   • Admin UI reads/writes via TeachingAssignment (AssignmentsDialog grid).
--   • Login routing reads from TeachingAssignment (AuthService).
--
-- The 20260510 + 20260511000000 backfills ensured every teacher with a
-- legacy classId already has a matching TeachingAssignment row. This
-- migration removes the now-vestigial columns + their FK constraints +
-- their indexes.
--
-- Order matters in Postgres: drop indexes first (otherwise the column
-- drop pulls them implicitly which prevents re-running cleanly), then
-- the constraints, then the columns.
-- ============================================================================

-- Drop the indexes that reference the legacy columns. Use IF EXISTS so
-- the migration can be re-applied to a fresh DB that never had them.
DROP INDEX IF EXISTS "teachers_classId_idx";
DROP INDEX IF EXISTS "teachers_sectionId_idx";

-- Drop the FK constraints. Names follow Prisma's default
-- "<table>_<column>_fkey" pattern.
ALTER TABLE "teachers" DROP CONSTRAINT IF EXISTS "teachers_classId_fkey";
ALTER TABLE "teachers" DROP CONSTRAINT IF EXISTS "teachers_sectionId_fkey";

-- Drop the columns themselves.
ALTER TABLE "teachers" DROP COLUMN IF EXISTS "classId";
ALTER TABLE "teachers" DROP COLUMN IF EXISTS "sectionId";
