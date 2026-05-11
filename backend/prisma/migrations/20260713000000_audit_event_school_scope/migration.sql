-- Phase — Operational visibility: denormalize schoolId onto
-- platform_audit_events so the school-side activity feed
-- (/audit/recent) can be served with one tenant-scoped query.
--
-- Hand-crafted to match the codebase migration convention. Pure
-- additive: nullable column + index, backfill from actor.user.schoolId.

-- ============================================================================
-- 1. Column + index
-- ============================================================================

ALTER TABLE "platform_audit_events"
  ADD COLUMN IF NOT EXISTS "schoolId" UUID;

CREATE INDEX IF NOT EXISTS "platform_audit_events_schoolId_createdAt_idx"
  ON "platform_audit_events" ("schoolId", "createdAt" DESC);

-- ============================================================================
-- 2. Backfill schoolId from actor.user.schoolId
-- ----------------------------------------------------------------------------
-- Every existing audit event has an actorUserId pointing at a User
-- (or NULL after SetNull cascade). When the actor is set, their
-- schoolId becomes the audit's schoolId — that's the tenant the
-- actor belongs to and approximates "which school does this event
-- pertain to" for legacy data.
--
-- Platform-only actions (no clear tenant) where the SUPER_ADMIN
-- actor lives in the placeholder platform school will inherit that
-- school's id; the school-side audit feed at /audit/recent runs
-- under @Roles(ADMIN, STAFF) so platform-school admins don't
-- exist as queriers anyway — the audits attributed to the platform
-- school are invisible to every real school's admin, which is the
-- desired outcome.
-- ============================================================================

UPDATE "platform_audit_events" ae
   SET "schoolId" = u."schoolId"
  FROM "users" u
 WHERE u."id"        = ae."actorUserId"
   AND ae."schoolId" IS NULL;
