-- ---------------------------------------------------------------------------
-- Phase 14 — Notification Center.
--
-- The Notifications table already exists from Phase 2. This migration
-- adds two columns the Notification Center UI needs:
--
--   • severity   — INFO / SUCCESS / WARNING / ERROR / CRITICAL.
--                  Drives the chip color + the unread-by-severity
--                  filter. Defaults to INFO so legacy rows keep
--                  working unchanged.
--   • readAt     — null until the operator opens the row in the
--                  Notification Center. Replaces a separate "reads"
--                  table — the platform UI is single-recipient
--                  (operator-facing) so per-user-read tracking adds
--                  no value. When school-side in-app notifications
--                  ship later, that surface gets its own read-state
--                  table; the platform uses this column.
--   • title      — denormalised display title. Templates produce a
--                  string at render time; persisting it lets the
--                  list view skip re-rendering every notification.
--                  Nullable so legacy rows continue working.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationSeverity') THEN
    CREATE TYPE "NotificationSeverity" AS ENUM (
      'INFO',
      'SUCCESS',
      'WARNING',
      'ERROR',
      'CRITICAL'
    );
  END IF;
END $$;

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO';

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP;

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "title" TEXT;

-- Filter on (severity, createdAt DESC) — the Notification Center's
-- default view is "newest first, optionally filtered by severity".
CREATE INDEX IF NOT EXISTS "notifications_severity_created_idx"
  ON "notifications" ("severity", "createdAt" DESC);

-- Filter on unread (readAt IS NULL) — the bell badge counts these.
CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
  ON "notifications" ("createdAt" DESC)
  WHERE "readAt" IS NULL;
