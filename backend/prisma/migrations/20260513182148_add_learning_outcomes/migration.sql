-- CreateEnum
CREATE TYPE "SubjectCode" AS ENUM ('NEPALI', 'ENGLISH', 'MATHEMATICS', 'SCIENCE_TECHNOLOGY', 'SOCIAL_STUDIES', 'HEALTH_PHYSICAL', 'ARTS_EDUCATION');

-- CreateEnum
CREATE TYPE "SkillArea" AS ENUM ('LISTENING', 'SPEAKING', 'READING', 'WRITING', 'VOCABULARY', 'LANGUAGE_STRUCTURE', 'CONTENT_AREA');

-- DropIndex
-- Session 4 fix (shadow-DB reproducibility): originally `DROP INDEX
-- "..."` without IF EXISTS, which failed when Prisma replayed the
-- migration history into a fresh shadow DB (the index is only created
-- by a LATER migration, 20260715000000_promotion_safety_publish_state,
-- so on a clean replay the DROP runs before any CREATE). IF EXISTS
-- matches the pattern in 20260511010000_drop_teacher_legacy_class_fields
-- and 20260711000000_school_code_and_student_registration. On a dev DB
-- where the index already exists this is a behavior-preserving no-op;
-- on a fresh shadow DB it makes the migration history replayable.
-- Checksum reconciled via `prisma migrate resolve --applied`.
DROP INDEX IF EXISTS "student_academic_records_promotedById_idx";

-- CreateTable
CREATE TABLE "learning_outcomes" (
    "id" TEXT NOT NULL,
    "classLevel" INTEGER NOT NULL,
    "subjectCode" "SubjectCode" NOT NULL,
    "curriculumVersion" TEXT NOT NULL DEFAULT '2083',
    "unitNumber" INTEGER NOT NULL,
    "unitTitleEn" TEXT,
    "unitTitleNp" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "skillArea" "SkillArea" NOT NULL,
    "descriptionEn" TEXT,
    "descriptionNp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_outcomes_classLevel_subjectCode_idx" ON "learning_outcomes"("classLevel", "subjectCode");

-- CreateIndex
CREATE INDEX "learning_outcomes_classLevel_subjectCode_unitNumber_idx" ON "learning_outcomes"("classLevel", "subjectCode", "unitNumber");

-- CreateIndex
CREATE UNIQUE INDEX "learning_outcomes_classLevel_subjectCode_unitNumber_sortOrd_key" ON "learning_outcomes"("classLevel", "subjectCode", "unitNumber", "sortOrder", "curriculumVersion");
