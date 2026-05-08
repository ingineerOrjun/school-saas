-- ---------------------------------------------------------------------------
-- Platform Control Layer — Phase 1 + Phase 3 (basic) schema additions.
--
-- Adds:
--   1. SUPER_ADMIN to the Role enum so platform owners can be
--      represented in the User table without polluting school admin UI.
--      The platform role gate at the controller layer + the "user
--      management UI never lists SUPER_ADMINs" rule in the service
--      together keep these rows invisible to school admins.
--
--   2. SchoolStatus enum (ACTIVE, TRIAL, SUSPENDED, EXPIRED) — the
--      lifecycle state of a tenant. Today's data is all ACTIVE; the
--      platform UI lets a SUPER_ADMIN flip schools to SUSPENDED to
--      block their users from logging in.
--
--   3. School.status / email / expiresAt — minimum fields the
--      platform schools table needs. Subscription plan + per-feature
--      flags are deliberately deferred to Phase 4 / 5 — adding them
--      here without their consuming code would just be dead columns.
-- ---------------------------------------------------------------------------

-- 1. Add SUPER_ADMIN to the Role enum. ADD VALUE is non-transactional
-- in PostgreSQL but cannot run inside a transaction block; Prisma's
-- migration runner already handles this correctly when the file
-- contains a single ADD VALUE per statement.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

-- 2. SchoolStatus enum + school columns.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SchoolStatus') THEN
    CREATE TYPE "SchoolStatus" AS ENUM ('ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED');
  END IF;
END $$;

ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "status"    "SchoolStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "email"     VARCHAR(180),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "schools_status_idx" ON "schools" ("status");
