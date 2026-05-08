-- ============================================================================
-- Student.symbolNumber — back-filled migration.
-- ----------------------------------------------------------------------------
-- The Nepal-style Symbol / Roll number column was originally added via
-- `prisma db push` and never had a migration file, causing
-- `prisma migrate dev` to detect drift between the migration history
-- and the live DB.
--
-- Plain ALTER (no IF NOT EXISTS) so the schema engine reliably emits
-- the DDL on the shadow DB. On the live DB — where the column already
-- exists — this migration is marked as applied via
--     prisma migrate resolve --applied 20260430005000_student_symbol_number
-- so it never re-runs there.
-- ============================================================================

ALTER TABLE "students"
  ADD COLUMN "symbolNumber" VARCHAR(40);

CREATE UNIQUE INDEX "students_schoolId_symbolNumber_key"
  ON "students" ("schoolId", "symbolNumber");
