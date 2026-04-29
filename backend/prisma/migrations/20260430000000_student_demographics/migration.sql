-- =============================================================================
-- Student demographics — required school-data fields
-- =============================================================================
-- Adds the four required fields (gender, dateOfBirth, parentName,
-- contactNumber) plus two optional ones (address, admissionDate).
--
-- Strategy for existing rows:
--   • Add columns nullable + with defaults so the table accepts existing data.
--   • Backfill the four required columns with safe placeholders.
--   • Promote those four to NOT NULL.
--
-- Idempotent — safe to re-run on fresh DBs and on already-migrated DBs.
-- =============================================================================

-- 1. Create the Gender enum if missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Gender') THEN
    CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
  END IF;
END
$$;

-- 2. Add columns. New columns start nullable so we can backfill cleanly.
ALTER TABLE "students"
  ADD COLUMN IF NOT EXISTS "gender"        "Gender",
  ADD COLUMN IF NOT EXISTS "dateOfBirth"   DATE,
  ADD COLUMN IF NOT EXISTS "parentName"    VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "contactNumber" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "address"       TEXT,
  ADD COLUMN IF NOT EXISTS "admissionDate" DATE;

-- 3. Backfill the required fields for any pre-existing students. Admins
--    can correct the placeholders from the Students UI; we just need
--    something non-null so we can promote the columns to NOT NULL.
UPDATE "students"
SET
  "gender"        = COALESCE("gender",        'OTHER'::"Gender"),
  "dateOfBirth"   = COALESCE("dateOfBirth",   DATE '2000-01-01'),
  "parentName"    = COALESCE("parentName",    'Unknown'),
  "contactNumber" = COALESCE("contactNumber", 'Unknown')
WHERE
  "gender"        IS NULL
  OR "dateOfBirth"   IS NULL
  OR "parentName"    IS NULL
  OR "contactNumber" IS NULL;

-- 4. Promote required columns to NOT NULL. Wrapped in a guard so the
--    migration is safe to re-run after the constraint is in place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='students' AND column_name='gender' AND is_nullable='YES'
  ) THEN
    ALTER TABLE "students" ALTER COLUMN "gender" SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='students' AND column_name='dateOfBirth' AND is_nullable='YES'
  ) THEN
    ALTER TABLE "students" ALTER COLUMN "dateOfBirth" SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='students' AND column_name='parentName' AND is_nullable='YES'
  ) THEN
    ALTER TABLE "students" ALTER COLUMN "parentName" SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='students' AND column_name='contactNumber' AND is_nullable='YES'
  ) THEN
    ALTER TABLE "students" ALTER COLUMN "contactNumber" SET NOT NULL;
  END IF;
END
$$;
