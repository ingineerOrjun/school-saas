-- Phase — Public school code + permanent student registration number.
--
-- Adds two new public identifiers and relaxes the User email index to
-- be tenant-scoped (so two schools may share email addresses, with
-- the schoolCode disambiguating at login).
--
-- Hand-crafted to match the codebase convention (see
-- 20260620000000_phase_alpha_backup_runs and similar). Idempotent
-- with `IF NOT EXISTS` / `IF EXISTS` guards so a partial application
-- can be replayed safely against the dev DB.

-- ============================================================================
-- 1. Audit enum additions
-- ============================================================================

ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'SCHOOL_CODE_ASSIGNED';
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'SCHOOL_CODE_UPDATED';

-- ============================================================================
-- 2. School.schoolCode
-- ----------------------------------------------------------------------------
-- Add as nullable, backfill SCH-0001…SCH-NNNN by createdAt asc, then
-- flip to NOT NULL and apply the unique constraint. Existing data is
-- test data per spec; ordering by createdAt gives the oldest school
-- the lowest code.
-- ============================================================================

ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "schoolCode" VARCHAR(40);

WITH ranked AS (
  SELECT
    "id",
    'SCH-' || LPAD(
      ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC)::text,
      4,
      '0'
    ) AS code
  FROM "schools"
  WHERE "schoolCode" IS NULL
)
UPDATE "schools" s
   SET "schoolCode" = ranked.code
  FROM ranked
 WHERE s."id" = ranked."id";

ALTER TABLE "schools"
  ALTER COLUMN "schoolCode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "schools_schoolCode_key"
  ON "schools" ("schoolCode");

-- ============================================================================
-- 3. User.email — relax from globally unique to per-tenant unique
-- ----------------------------------------------------------------------------
-- The old `users_email_key` index enforced global uniqueness, so the
-- backfill cannot produce a conflict (every existing email is unique
-- across all schools). We drop the old index and create the compound
-- one.
-- ============================================================================

DROP INDEX IF EXISTS "users_email_key";

CREATE UNIQUE INDEX IF NOT EXISTS "users_schoolId_email_key"
  ON "users" ("schoolId", "email");

-- ============================================================================
-- 4. Student.registrationNumber
-- ----------------------------------------------------------------------------
-- Format: SCHOOLCODE-YYYY-CLASS-SERIAL
--
-- SCHOOLCODE: schools.schoolCode with dashes stripped (SCH-0001 → SCH0001)
-- YYYY:       admission year — uses students.admissionDate when set,
--             else students.createdAt
-- CLASS:      normalized admitted-class code per the rules in
--             StudentRegistrationNumberService.normalizeClassCode():
--               • numeric grades → 2-digit zero-pad
--               • named ("Nursery"→"NUR", "Pre-K"→"PRE", "LKG"→"LKG",
--                        "UKG"→"UKG", "Kindergarten"→"KIN")
--               • fallback → first 3 alphanumeric uppercase chars
-- SERIAL:     ROW_NUMBER() over (school, year, class) ordered by
--             createdAt ASC + id ASC for determinism.
--
-- Students with NULL classId at creation cannot be encoded — they
-- stay registrationNumber=NULL and will be assigned at the next
-- create-with-class.
-- ============================================================================

ALTER TABLE "students"
  ADD COLUMN IF NOT EXISTS "registrationNumber" VARCHAR(60);

CREATE UNIQUE INDEX IF NOT EXISTS "students_registrationNumber_key"
  ON "students" ("registrationNumber");

CREATE INDEX IF NOT EXISTS "students_schoolId_registrationNumber_idx"
  ON "students" ("schoolId", "registrationNumber");

-- Backfill helper — same normalization rules as the TypeScript
-- service. Inlined as a CASE expression so the migration stays
-- self-contained (no PL/pgSQL function to drop later).
WITH normalized AS (
  SELECT
    st."id",
    sc."schoolCode",
    EXTRACT(YEAR FROM COALESCE(st."admissionDate", st."createdAt"))::int AS year,
    CASE
      -- numeric grades — extract digits via scalar substring(), zero-pad
      WHEN c."name" ~ '\d+'
        THEN LPAD(SUBSTRING(c."name" FROM '\d+'), 2, '0')
      -- named buckets — match common Nepal/SE-Asia preschool labels
      WHEN UPPER(REGEXP_REPLACE(c."name", '[^A-Za-z0-9]', '', 'g')) IN ('NURSERY', 'NUR') THEN 'NUR'
      WHEN UPPER(REGEXP_REPLACE(c."name", '[^A-Za-z0-9]', '', 'g')) IN ('PREK', 'PRE', 'PREKINDERGARTEN') THEN 'PRE'
      WHEN UPPER(REGEXP_REPLACE(c."name", '[^A-Za-z0-9]', '', 'g')) IN ('LKG') THEN 'LKG'
      WHEN UPPER(REGEXP_REPLACE(c."name", '[^A-Za-z0-9]', '', 'g')) IN ('UKG') THEN 'UKG'
      WHEN UPPER(REGEXP_REPLACE(c."name", '[^A-Za-z0-9]', '', 'g')) IN ('KINDERGARTEN', 'KG', 'KIN') THEN 'KIN'
      -- fallback — first 3 uppercase alphanumeric chars
      ELSE LEFT(UPPER(REGEXP_REPLACE(c."name", '[^A-Za-z0-9]', '', 'g')), 3)
    END AS class_code,
    st."createdAt",
    st."schoolId"
  FROM "students" st
  JOIN "schools" sc ON sc."id" = st."schoolId"
  JOIN "classes" c  ON c."id"  = st."classId"
  WHERE st."classId" IS NOT NULL
    AND st."registrationNumber" IS NULL
),
serialised AS (
  SELECT
    "id",
    REPLACE("schoolCode", '-', '') AS school_code_compact,
    year,
    class_code,
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY "schoolId", year, class_code
        ORDER BY "createdAt" ASC, "id" ASC
      )::text,
      4,
      '0'
    ) AS serial
  FROM normalized
)
UPDATE "students" s
   SET "registrationNumber" =
       serialised.school_code_compact || '-' ||
       serialised.year::text          || '-' ||
       serialised.class_code          || '-' ||
       serialised.serial
  FROM serialised
 WHERE s."id" = serialised."id";
