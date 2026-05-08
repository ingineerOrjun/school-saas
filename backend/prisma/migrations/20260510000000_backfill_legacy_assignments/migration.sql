-- ============================================================================
-- Backfill TeachingAssignment from legacy Teacher.classId
-- ----------------------------------------------------------------------------
-- The original 20260503 migration backfilled assignments from any teacher
-- that already had a legacy classId. But teachers added AFTER that
-- migration through the Add Teacher dialog (createWithUser) wrote to the
-- legacy column WITHOUT creating a TeachingAssignment row — so their
-- dashboard incorrectly showed "Not assigned" even after admins picked a
-- class.
--
-- The service layer is now fixed (createWithUser + update mirror the
-- legacy pick into a real assignment), but existing affected rows in
-- the DB still need to be patched up. This migration is the catch-up.
--
-- `IS NOT DISTINCT FROM` handles the NULL section comparison — Postgres
-- normally treats NULL as != NULL, but `IS NOT DISTINCT FROM` returns
-- true when both sides are NULL. Without it, the NOT EXISTS check would
-- always fail for class-only assignments and we'd insert duplicates.
-- ============================================================================

INSERT INTO "teaching_assignments"
  ("id", "teacherId", "classId", "sectionId", "subjectId", "schoolId")
SELECT
  gen_random_uuid(),
  t."id",
  t."classId",
  t."sectionId",
  NULL,
  t."schoolId"
FROM "teachers" t
WHERE t."classId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "teaching_assignments" ta
    WHERE ta."teacherId" = t."id"
      AND ta."classId"   = t."classId"
      AND ta."sectionId" IS NOT DISTINCT FROM t."sectionId"
      AND ta."subjectId" IS NULL
  );
