-- ---------------------------------------------------------------------------
-- Phase 17 — Maintenance mode.
--
-- A per-tenant read-only flag distinct from SUSPENDED:
--
--   • SUSPENDED  → users can't log in. Used for "this account is in
--                  dispute / non-payment / abuse." Hard gate.
--   • MAINTENANCE → users CAN log in and read, but writes are rejected
--                  with 503. Used for "operator is doing data
--                  fixes / migration / investigation; please don't
--                  touch the data." Soft gate.
--
-- The flag is a boolean column instead of a new SchoolStatus value
-- because a school can be ACTIVE-and-in-maintenance (operator
-- pausing writes during a support session) — the dimensions are
-- orthogonal.
--
-- A new audit action SCHOOL_MAINTENANCE_TOGGLED captures every flip
-- so the trail records who paused / resumed and why.
-- ---------------------------------------------------------------------------

ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "maintenanceMode" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "PlatformAuditAction"
  ADD VALUE IF NOT EXISTS 'SCHOOL_MAINTENANCE_TOGGLED';
