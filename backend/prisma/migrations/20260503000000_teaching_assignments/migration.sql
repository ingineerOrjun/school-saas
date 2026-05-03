-- ============================================================================
-- Multi-class teacher scoping
-- ----------------------------------------------------------------------------
-- Adds two tables:
--   • subjects             — school-owned subject catalog (Math, Science, ...)
--   • teaching_assignments — teacher × (class, optional section, optional subject)
--
-- Backfills a teaching_assignments row for every existing teacher who has a
-- non-null Teacher.classId so today's permission checks keep working without
-- any admin action. The legacy Teacher.classId / Teacher.sectionId columns
-- stay for now (login routing still reads them); they'll be retired once the
-- assign-by-dialog UI replaces the single-class picker.
--
-- Idempotent: every CREATE/INSERT is guarded so re-running this migration on
-- a database that's already up to date is a no-op.
-- ============================================================================

-- ----- subjects ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "subjects" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"      TEXT         NOT NULL,
  "schoolId"  UUID         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- Unique subject name within a school.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'subjects_schoolId_name_key'
  ) THEN
    CREATE UNIQUE INDEX "subjects_schoolId_name_key" ON "subjects" ("schoolId", "name");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'subjects_schoolId_idx'
  ) THEN
    CREATE INDEX "subjects_schoolId_idx" ON "subjects" ("schoolId");
  END IF;
END $$;

-- FK to schools — cascade on tenant delete.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subjects_schoolId_fkey'
  ) THEN
    ALTER TABLE "subjects"
      ADD CONSTRAINT "subjects_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ----- teaching_assignments -----------------------------------------------
CREATE TABLE IF NOT EXISTS "teaching_assignments" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "teacherId" UUID         NOT NULL,
  "classId"   UUID         NOT NULL,
  "sectionId" UUID,
  "subjectId" UUID,
  "schoolId"  UUID         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "teaching_assignments_pkey" PRIMARY KEY ("id")
);

-- (teacherId, classId, sectionId, subjectId) uniqueness — Postgres treats
-- NULLs as distinct, so this only catches truly identical non-null tuples.
-- The service layer rejects "same teacher × class × NULL × NULL" duplicates.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'teaching_assignments_teacherId_classId_sectionId_subjectId_key'
  ) THEN
    CREATE UNIQUE INDEX "teaching_assignments_teacherId_classId_sectionId_subjectId_key"
      ON "teaching_assignments" ("teacherId", "classId", "sectionId", "subjectId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'teaching_assignments_schoolId_idx'
  ) THEN
    CREATE INDEX "teaching_assignments_schoolId_idx" ON "teaching_assignments" ("schoolId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'teaching_assignments_teacherId_idx'
  ) THEN
    CREATE INDEX "teaching_assignments_teacherId_idx" ON "teaching_assignments" ("teacherId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'teaching_assignments_classId_idx'
  ) THEN
    CREATE INDEX "teaching_assignments_classId_idx" ON "teaching_assignments" ("classId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'teaching_assignments_sectionId_idx'
  ) THEN
    CREATE INDEX "teaching_assignments_sectionId_idx" ON "teaching_assignments" ("sectionId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'teaching_assignments_subjectId_idx'
  ) THEN
    CREATE INDEX "teaching_assignments_subjectId_idx" ON "teaching_assignments" ("subjectId");
  END IF;
END $$;

-- FKs — cascade for tenant + parent delete; setNull for soft-deletable
-- side relationships (section/subject can be removed without losing the
-- whole assignment row, just narrowed back).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teaching_assignments_teacherId_fkey'
  ) THEN
    ALTER TABLE "teaching_assignments"
      ADD CONSTRAINT "teaching_assignments_teacherId_fkey"
      FOREIGN KEY ("teacherId") REFERENCES "teachers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teaching_assignments_classId_fkey'
  ) THEN
    ALTER TABLE "teaching_assignments"
      ADD CONSTRAINT "teaching_assignments_classId_fkey"
      FOREIGN KEY ("classId") REFERENCES "classes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teaching_assignments_sectionId_fkey'
  ) THEN
    ALTER TABLE "teaching_assignments"
      ADD CONSTRAINT "teaching_assignments_sectionId_fkey"
      FOREIGN KEY ("sectionId") REFERENCES "sections"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teaching_assignments_subjectId_fkey'
  ) THEN
    ALTER TABLE "teaching_assignments"
      ADD CONSTRAINT "teaching_assignments_subjectId_fkey"
      FOREIGN KEY ("subjectId") REFERENCES "subjects"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teaching_assignments_schoolId_fkey'
  ) THEN
    ALTER TABLE "teaching_assignments"
      ADD CONSTRAINT "teaching_assignments_schoolId_fkey"
      FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ----- Backfill -----------------------------------------------------------
-- Mirror every existing teacher's single class/section into a
-- TeachingAssignment row so the new permission layer recognizes them
-- without any admin action. ON CONFLICT DO NOTHING makes this safe to
-- re-run if the migration is replayed.
INSERT INTO "teaching_assignments" ("id", "teacherId", "classId", "sectionId", "subjectId", "schoolId")
SELECT
  gen_random_uuid(),
  t."id",
  t."classId",
  t."sectionId",
  NULL,
  t."schoolId"
FROM "teachers" t
WHERE t."classId" IS NOT NULL
ON CONFLICT ("teacherId", "classId", "sectionId", "subjectId") DO NOTHING;
