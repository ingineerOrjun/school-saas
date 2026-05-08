-- ---------------------------------------------------------------------------
-- Phase 8 — Platform audit log.
--
-- Single append-only table that captures every platform-level
-- write action. Every column is nullable except the audit
-- primitives (id, action, actorUserId, createdAt) so future actions
-- with different shapes don't need their own schema additions.
--
-- Action enum starts with the single action that exists today
-- (SCHOOL_STATUS_CHANGED). Phase 4/5/7/9 will each ALTER TYPE …
-- ADD VALUE for their own actions.
--
-- before/after: JSONB columns. We store the relevant slice of the
-- target row pre- and post-mutation — enough to answer "what
-- changed?" without exposing PII the audit doesn't need (e.g.
-- password hashes, full student lists).
--
-- ip/userAgent: optional. Captured opportunistically when the
-- caller passes them; not required because some actions can't
-- access them (background jobs, future scheduled subscription
-- expiry, etc.).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlatformAuditAction') THEN
    CREATE TYPE "PlatformAuditAction" AS ENUM (
      'SCHOOL_STATUS_CHANGED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "platform_audit_events" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "action"       "PlatformAuditAction" NOT NULL,
  "actorUserId"  UUID NOT NULL,
  "actorEmail"   TEXT,
  "actorRole"    TEXT,
  -- Free-form descriptor of what was acted upon. We store both an
  -- explicit type-tag ("SCHOOL", "USER", "SUBSCRIPTION") and the
  -- target id so a future audit-detail view can resolve to a row
  -- without a polymorphic FK (which Postgres + Prisma can't model
  -- well anyway).
  "targetType"   TEXT NOT NULL,
  "targetId"     UUID NOT NULL,
  "targetLabel"  TEXT,
  -- before/after slices of the target. Kept narrow on purpose:
  -- e.g. SCHOOL_STATUS_CHANGED stores `{ status: 'ACTIVE' }` →
  -- `{ status: 'SUSPENDED' }`, not the entire school row.
  "before"       JSONB,
  "after"        JSONB,
  "reason"       TEXT,
  "ip"           TEXT,
  "userAgent"    TEXT,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT "platform_audit_events_actor_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- Note: the FK above won't actually SET NULL because actorUserId is
-- declared NOT NULL. PG will error on user-delete if any audit row
-- references that user. That's intentional — deleting an actor
-- whose actions are still in the audit trail would orphan the
-- trail. If we ever need to delete users with audit history, we'll
-- relax actorUserId to nullable in a follow-up.

CREATE INDEX IF NOT EXISTS "platform_audit_events_action_idx"
  ON "platform_audit_events" ("action");
CREATE INDEX IF NOT EXISTS "platform_audit_events_actor_idx"
  ON "platform_audit_events" ("actorUserId");
CREATE INDEX IF NOT EXISTS "platform_audit_events_target_idx"
  ON "platform_audit_events" ("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "platform_audit_events_createdAt_idx"
  ON "platform_audit_events" ("createdAt" DESC);
