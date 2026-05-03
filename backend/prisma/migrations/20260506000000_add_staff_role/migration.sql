-- ============================================================================
-- Add STAFF to the Role enum
-- ----------------------------------------------------------------------------
-- Mid-level academic role: can manage subjects/exams and enter
-- results+attendance for ANY class without a teacher-scope check.
-- Cannot manage students, fees, users, classes, or teachers — those
-- remain admin-only.
--
-- Postgres `ALTER TYPE ... ADD VALUE IF NOT EXISTS` is idempotent and
-- runs outside a transaction, so this is the standard safe pattern for
-- enum extensions. Ordering ('AFTER ''ADMIN''') matches the schema
-- declaration order so Prisma's generated client mirrors the enum.
-- ============================================================================

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'STAFF' AFTER 'ADMIN';
