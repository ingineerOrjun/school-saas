-- ============================================================================
-- Enforce: every Teacher MUST have a linked User account
-- ----------------------------------------------------------------------------
-- The teacher dashboard resolves assignments via
--   `Teacher.userId === currentUser.id`,
-- so a Teacher row with `userId = NULL` is unreachable from the teacher's
-- POV — assignments added to that row are silently invisible. This migration
-- removes the orphan-row possibility at the DB level:
--
--   1. DELETE every existing Teacher with userId = NULL. Their attached
--      TeachingAssignment rows cascade away via the existing FK
--      (`teaching_assignments_teacherId_fkey ... ON DELETE CASCADE`).
--   2. ALTER the column to NOT NULL.
--   3. Replace the user FK so deleting a User cascades to the Teacher
--      (was ON DELETE SET NULL, which would re-create the orphan state).
--
-- All steps are idempotent. Re-running the migration is a no-op.
-- ============================================================================

-- ----- Step 1: clean up orphan teachers --------------------------------------
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM "teachers" WHERE "userId" IS NULL;
  IF orphan_count > 0 THEN
    RAISE NOTICE
      'teacher_user_required: deleting % orphan teacher row(s) (userId IS NULL). Their TeachingAssignments cascade away.',
      orphan_count;
    DELETE FROM "teachers" WHERE "userId" IS NULL;
  END IF;
END $$;

-- ----- Step 2: tighten the column to NOT NULL --------------------------------
-- ALTER ... SET NOT NULL is idempotent: PG no-ops when the column is
-- already NOT NULL.
ALTER TABLE "teachers" ALTER COLUMN "userId" SET NOT NULL;

-- ----- Step 3: swap the user FK to ON DELETE CASCADE -------------------------
-- The old constraint was created with ON DELETE SET NULL — which would
-- re-introduce orphan rows the moment a User got deleted. We swap it for
-- CASCADE so the Teacher follows the User out the door.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'teachers'
      AND tc.constraint_name = 'teachers_userId_fkey'
      AND rc.delete_rule <> 'CASCADE'
  ) THEN
    ALTER TABLE "teachers" DROP CONSTRAINT "teachers_userId_fkey";
    ALTER TABLE "teachers"
      ADD CONSTRAINT "teachers_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
