-- ============================================================================
-- Final safety backfill before dropping the legacy Teacher.classId /
-- Teacher.sectionId columns.
--
-- The 20260510 backfill ran once at the time it was added. This pass is
-- the LAST chance to catch any teacher row that:
--   • Was created before this finalize pass
--   • Has a non-null legacy classId
--   • Doesn't have a matching TeachingAssignment
--
-- Idempotent — `NOT EXISTS` guards against re-inserting rows the prior
-- backfill already covered, and `IS NOT DISTINCT FROM` makes the NULL
-- section comparison work the way humans expect (NULL == NULL).
--
-- Anything still mismatched after this migration would surface as the
-- next migration drops the columns: that drop is destructive, so this
-- safety pass MUST run first.
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
